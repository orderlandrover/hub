import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from "xlsx";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

type RoundMode = "near" | "up" | "down";
type UploadBody = {
  filename: string;
  base64: string;       // filinnehåll base64
  fx: number;           // GBP -> SEK
  markupPct: number;    // t.ex. 25
  roundMode: RoundMode; // "near" | "up" | "down"
  step: number;         // t.ex. 1, 5, 10
  publish?: boolean;    // valfritt
  dryRun?: boolean;     // true = skriv inte till WC
};

type Row = { sku: string; gbp: number };

function toBuffer(b64: string) {
  return Buffer.from(b64, "base64");
}

function roundToStep(value: number, step: number, mode: RoundMode): number {
  if (step <= 0) return Math.round(value * 100) / 100;
  const q = value / step;
  let r: number;
  switch (mode) {
    case "up":   r = Math.ceil(q); break;
    case "down": r = Math.floor(q); break;
    default:     r = Math.round(q);
  }
  return r * step;
}

// Försöker mappa en rad (objekt) till {sku, gbp}
function smartRow(v: any): Row | null {
  if (!v) return null;
  const keys = Object.keys(v);

  const skuKey = keys.find(k => /^(sku|part|part\s*number|code|artikel|artnr)$/i.test(String(k).trim()));
  const priceKey = keys.find(k => /(gbp|price.*gbp|pris.*gbp|price|pris)/i.test(String(k).trim()));

  const rawSku = skuKey ? v[skuKey] : undefined;
  const sku = String(rawSku ?? "").trim();

  const rawGbp = priceKey ? v[priceKey] : undefined;
  const gbp = Number(String(rawGbp ?? "").replace(",", "."));

  if (!sku || !isFinite(gbp)) return null;
  return { sku, gbp };
}

// Läs workbook robust (Buffer -> 'buffer', fallback till string/CSV)
function readWorkbook(filename: string, b64: string) {
  const buf = toBuffer(b64);

  // 1) prova buffer
  try {
    return XLSX.read(buf, { type: "buffer", raw: true });
  } catch {
    // fortsätt
  }
  // 2) prova som text (CSV)
  const txt = buf.toString("utf8");
  return XLSX.read(txt, { type: "string", raw: true });
}

// liten concurrency-hjälpare så vi inte kör 1000 requests i serie
async function pMap<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return out;
}

app.http("price-upload", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      const body = (await req.json()) as UploadBody;
      if (!body?.base64 || !body?.filename) {
        return { status: 400, jsonBody: { error: "filename och base64 krävs" } };
      }

      const fx = Number(body.fx ?? 0);
      const markup = Number(body.markupPct ?? 0) / 100;
      const step = Number(body.step ?? 1);
      const mode: RoundMode = (body.roundMode as RoundMode) || "near";
      const dryRun = !!body.dryRun;

      if (!isFinite(fx) || fx <= 0) return { status: 400, jsonBody: { error: "Ogiltig valutakurs (fx)" } };

      // 1) Läs arbetsbok robust
      const wb = readWorkbook(body.filename, body.base64);
      const sheetName = wb.SheetNames[0];
      if (!sheetName) return { status: 400, jsonBody: { error: "Filen verkar sakna data" } };

      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];

      // 2) Extrahera (sku, gbp)
      const parsed: Row[] = rows.map(smartRow).filter((x): x is Row => !!x);
      if (parsed.length === 0) {
        return { status: 400, jsonBody: { error: "Kunde inte tolka filen (hittade inga SKU/GBP)" } };
      }

      // 3) Kör i rimlig parallelism (5 i taget)
      const updates: any[] = [];
      const skipped: any[] = [];
      const notFound: string[] = [];
      const errors: { sku: string; error: string }[] = [];

      await pMap(parsed, 5, async (r) => {
        try {
          // Hämta produkt via SKU
          const resList = await wcRequest(`/products?sku=${encodeURIComponent(r.sku)}`);
          const list = await resList.json();
          const p = Array.isArray(list) && list[0];

          if (!p) { notFound.push(r.sku); return; }

          const current = Number(p?.regular_price ?? 0);
          const sek = roundToStep(r.gbp * fx * (1 + markup), step, mode);
          const next = Number(sek.toFixed(2));

          if (isFinite(current) && Math.abs(current - next) < 0.009) {
            skipped.push({ id: p.id, sku: r.sku, price: current });
            return;
          }

          if (dryRun) {
            updates.push({ id: p.id, sku: r.sku, from: current, to: next, dryRun: true });
            return;
          }

          const patch: any = { regular_price: String(next) };
          if (body.publish === true) patch.status = "publish";

          const resPut = await wcRequest(`/products/${p.id}`, {
            method: "PUT",
            body: JSON.stringify(patch),
          });
          const saved = await resPut.json();
          updates.push({ id: saved.id, sku: r.sku, from: current, to: next });
        } catch (e: any) {
          errors.push({ sku: r.sku, error: e?.message || String(e) });
        }
      });

      return {
        jsonBody: {
          ok: true,
          total: parsed.length,
          updated: updates.length,
          skipped: skipped.length,
          notFound: notFound.length,
          errors: errors.length,
          sample: {
            updates: updates.slice(0, 10),
            skipped: skipped.slice(0, 5),
            notFound: notFound.slice(0, 10),
            errors: errors.slice(0, 5),
          },
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || "Unknown error" } };
    }
  },
});