import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { parse } from "csv-parse/sync";
import { wcFetch, readJsonSafe } from "../shared/wc";
import { calcSEK, RoundMode } from "../shared/pricing";

type UploadBody = {
  filename: string;
  base64: string;
  fx?: number;
  markupPct?: number;
  roundMode?: RoundMode;
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

function detectDelimiter(text: string) {
  const first = text.split(/\r?\n/).slice(0, 3).join("\n");
  const c = { ",": (first.match(/,/g) || []).length, ";": (first.match(/;/g) || []).length, "\t": (first.match(/\t/g) || []).length };
  const best = Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}
function normHdr(s: string) { return s.replace(/\uFEFF/g,"").replace(/\s+/g," ").trim(); }

const SKU_KEYS = ["Part No", "PartNo", "Part_No", "SKU", "Code", "Part Number"];
const PRICE_KEYS = ["Price", "GBP", "RRP"];

function pickSku(row: Record<string,string>) {
  for (const k of SKU_KEYS) { if (row[k] && String(row[k]).trim()) return String(row[k]).trim(); }
  return "";
}
function pickGbp(row: Record<string,string>) {
  for (const k of PRICE_KEYS) {
    if (k in row) {
      const v = String(row[k] ?? "").replace(",", ".").trim();
      const n = Number.parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

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
      const limit = Math.max(1, Math.min(2000, Number(body.limit ?? 500)));

      const buf = Buffer.from(body.base64, "base64");
      let csvText = buf.toString("utf8");
      if ((csvText.match(/\uFFFD/g) || []).length > 10) csvText = buf.toString("latin1");

      const delimiter = detectDelimiter(csvText);
      const rows = parse(csvText, {
        columns: (h: string[]) => h.map(normHdr),
        delimiter,
        bom: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true,
        trim: true
      }) as Record<string,string>[];

      const total = rows.length;
      const slice = rows.slice(offset, offset + limit);

      let updated = 0, skipped = 0, notFound = 0, badRows = 0;
      const sample = { updates: [] as any[], errors: [] as any[] };

      for (let i = 0; i < slice.length; i++) {
        const raw = slice[i] || {};
        try {
          const sku = pickSku(raw);
          const gbp = pickGbp(raw);
          if (!sku || !Number.isFinite(gbp)) { skipped++; continue; }

          const priceSEK = calcSEK(gbp, fx, markupPct, step, roundMode).toFixed(2);

          const find = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
          const { json: list, text: tFind } = await readJsonSafe(find);
          if (!find.ok || !Array.isArray(list)) throw new Error(`Woo /products?sku ${find.status}: ${tFind.slice(0,180)}`);
          if (list.length === 0) { notFound++; if (sample.errors.length < 5) sample.errors.push({ sku, reason: "not found" }); continue; }

          const { id, regular_price } = list[0] || {};
          if (dryRun) { updated++; if (sample.updates.length < 5) sample.updates.push({ id, sku, from: regular_price, to: priceSEK }); continue; }

          const payload: any = { regular_price: priceSEK };
          if (publish) payload.status = "publish";
          const upd = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
          if (upd.ok) { updated++; if (sample.updates.length < 5) sample.updates.push({ id, sku, to: priceSEK }); }
          else {
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
          nextOffset
        },
        headers: CORS
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "price-upload failed" }, headers: CORS };
    }
  }
});