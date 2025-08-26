import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { parse } from "csv-parse/sync";
import { wcFetch, readJsonSafe } from "../shared/wc";
import { calcSEK, RoundMode } from "../shared/pricing";

type UploadBody = {
  filename: string;
  base64: string;
  fx?: number;
  markupPct?: number;
  roundMode?: RoundMode; // "near" | "up" | "down"
  step?: number;
  publish?: boolean;
  dryRun?: boolean;
  offset?: number;   // 0-baserad
  limit?: number;    // antal rader i denna batch
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// --- CSV helpers -------------------------------------------------------------

function detectDelimiter(text: string) {
  const first = text.split(/\r?\n/).slice(0, 3).join("\n");
  const c = { ",": (first.match(/,/g) || []).length, ";": (first.match(/;/g) || []).length, "\t": (first.match(/\t/g) || []).length };
  const best = Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
  return best && best[1] > 0 ? (best[0] as string) : ",";
}

function normHdr(s: string) { return s.replace(/\uFEFF/g,"").replace(/\s+/g," ").trim(); }
function getCI(obj: Record<string, any>, key: string) {
  const found = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
  return found ? obj[found] : undefined;
}

// toleranta nycklar (behåller dina original + några vanliga varianter)
const SKU_KEYS = ["Part No","PartNo","Part_No","SKU","Code","Part Number","Article","Art Nr","Art.Nr"];
const PRICE_KEYS_GBP = [
  "Price","GBP","RRP","Price GBP","GBP Price","Unit Price","Net Price","List Price",
  "Pris (GBP)","Pris GBP","RRP GBP"
];
const PRICE_KEYS_SEK = ["SEK","Price SEK","Pris (SEK)","Pris SEK"];

function pickSku(row: Record<string, any>) {
  for (const k of SKU_KEYS) {
    const v = getCI(row, k);
    if (v !== undefined && String(v).trim()) return String(v).trim();
  }
  return "";
}
function pickNumberLike(v: any) {
  const s = String(v ?? "")
    .replace(/\s/g, "")
    .replace(/,/g, ".") // <- /g
    .trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
function pickGbp(row: Record<string, any>) {
  // 1) Försök enligt vanliga prisnycklar (Price, GBP, RRP, etc.)
  const PRICE_KEYS = ["Price","GBP","RRP","Price GBP","GBP Price","Unit Price","Net Price","List Price","Pris (GBP)","Pris GBP","RRP GBP"];
  for (const k of PRICE_KEYS) {
    const v = getCI(row, k);
    if (v !== undefined) {
      const n = pickNumberLike(v);
      if (Number.isFinite(n)) return n;
    }
  }

  // 2) SPECIALFALL för din CSV: många rader har prisvärdet i "Description" p.g.a. fel headerordning.
  //    - Om "Price" inte är numeriskt (dvs text som "SP CLUTCH ..."/"EA")
  //    - och "Description" ÄR numeriskt (t.ex. 57.42)
  //    -> tolka Description som pris.
  const priceRaw = getCI(row, "Price");
  const priceNum = pickNumberLike(priceRaw);
  const descRaw  = getCI(row, "Description");
  const descNum  = pickNumberLike(descRaw);

  // Om "Per" ser ut som en enhetskod ("EA", "HD", "SET", "PK", ...) stärker vi hypotesen att tredje kolumnen var det riktiga priset.
  const per = String(getCI(row, "Per") ?? "").trim();


  if (!Number.isFinite(priceNum) && Number.isFinite(descNum)) {
    return descNum; // priset ligger under "Description" i just denna CSV
  }

  // 3) Sista fallback: skanna alla fält och ta första "rimliga" priset (0.01–100000) om vi missat alla ovan.
  for (const key of Object.keys(row)) {
    const n = pickNumberLike(row[key]);
    if (Number.isFinite(n) && n >= 0.01 && n <= 100000) {
      // Undvik att råka ta t.ex. "UOI=1", men om vi har en units-kolumn som ser rimlig ut accepterar vi detta som sista utväg.
      if (key.toLowerCase() !== "uoi" || n > 1.0) {
        return n;
      }
    }
  }

  return NaN;
}
function pickSek(row: Record<string, any>) {
  for (const k of PRICE_KEYS_SEK) {
    const raw = getCI(row, k);
    if (raw !== undefined) {
      const n = pickNumberLike(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

// ---------------------------------------------------------------------------

app.http("price-upload", {
  route: "price-upload",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "price-upload" }, headers: CORS };

    try {
      const body = (await req.json()) as UploadBody;
      if (!body?.base64) return { status: 400, jsonBody: { error: "Missing base64" }, headers: CORS };

      const fx = Number(body.fx ?? 13.0);
      const markupPct = Number(body.markupPct ?? 0);
      const step = Number(body.step ?? 1);
      const roundMode = (body.roundMode ?? "near") as RoundMode;
      const publish = !!body.publish;
      const dryRun = !!body.dryRun;

      const offset = Math.max(0, Number(body.offset ?? 0));
      // större default och högre tak → färre anrop för 29k rader
      const limit = Math.max(1, Math.min(20000, Number(body.limit ?? 5000)));

      const buf = Buffer.from(body.base64, "base64");
      let csvText = buf.toString("utf8");
      // fallback om UTF-8 blir konstigt
      if ((csvText.match(/\uFFFD/g) || []).length > 10) csvText = buf.toString("latin1");

      const delimiter = ",";
      const rows = parse(csvText, {
        columns: (h: string[]) => h.map(normHdr),
        delimiter,
        bom: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true,
        trim: true
      }) as Record<string,any>[];

      const total = rows.length;
      const slice = rows.slice(offset, Math.min(offset + limit, total));

      let updated = 0, skipped = 0, notFound = 0, badRows = 0;
      const sample = { updates: [] as any[], errors: [] as any[], skipped: [] as any[] };

      for (let i = 0; i < slice.length; i++) {
        const raw = slice[i] || {};
        try {
          const sku = pickSku(raw);

          // pris kan vara GBP eller SEK; GBP prioriteras (din logik via calcSEK)
          const gbp = pickGbp(raw);
          let targetSEK: string;

          if (Number.isFinite(gbp)) {
            targetSEK = calcSEK(gbp, fx, markupPct, step, roundMode).toFixed(2);
          } else {
            const sek = pickSek(raw);
            if (!Number.isFinite(sek)) {
              skipped++;
              if (sample.skipped.length < 5) sample.skipped.push({ reason: "invalid price", raw });
              continue;
            }
            targetSEK = Number(sek).toFixed(2);
          }

          if (!sku) {
            skipped++;
            if (sample.skipped.length < 5) sample.skipped.push({ reason: "missing sku", raw });
            continue;
          }

          // hitta produkt i Woo på SKU
          const find = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
          const { json: list, text: tFind } = await readJsonSafe(find);
          if (!find.ok || !Array.isArray(list)) throw new Error(`Woo /products?sku ${find.status}: ${tFind.slice(0,180)}`);
          if (list.length === 0) { notFound++; if (sample.errors.length < 5) sample.errors.push({ sku, reason: "not found" }); continue; }

          const { id, regular_price } = list[0] || {};
          if (dryRun) {
            updated++; // räknas som "skulle uppdateras"
            if (sample.updates.length < 5) sample.updates.push({ id, sku, from: regular_price, to: targetSEK, dryRun: true });
            continue;
          }

          const payload: any = { regular_price: targetSEK };
          if (publish) payload.status = "publish";

          const upd = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
          if (upd.ok) {
            updated++;
            if (sample.updates.length < 5) sample.updates.push({ id, sku, from: regular_price, to: targetSEK });
          } else {
            const msg = await upd.text();
            badRows++;
            if (sample.errors.length < 5) sample.errors.push({ sku, error: msg || "update failed" });
          }
        } catch (e: any) {
          badRows++;
          if (sample.errors.length < 5) sample.errors.push({ error: e?.message || String(e) });
        }
      }

      const nextOffset = offset + slice.length < total ? offset + slice.length : null;

      return {
        status: 200,
        jsonBody: {
          ok: true,
          filename: body.filename || null,
          total,
          processedBatch: slice.length,
          processedGlobal: offset + slice.length,
          updated, skipped, notFound, badRows,
          errors: sample.errors.length,
          sample,
          nextOffset,
          // tydliga körparametrar i svaret → enklare felsökning i UI
          dryRun, publish, fx, markupPct, step, roundMode
        },
        headers: CORS
      };
    } catch (e: any) {
      ctx.error?.(e);
      return { status: 500, jsonBody: { error: e?.message || "price-upload failed" }, headers: CORS };
    }
  }
});