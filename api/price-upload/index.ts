import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { parse } from "csv-parse/sync";
import { wcFetch } from "../shared/wc";

/* ======================================================================
   Typer
====================================================================== */
type UploadBody = {
  filename: string;
  base64: string;                    // CSV i base64 (från UI)
  fx?: number;                       // GBP->SEK
  markupPct?: number;                // påslag i %
  roundMode?: "near" | "up" | "down" | "none";
  step?: number;                     // avrundning (SEK)
  publish?: boolean;
  dryRun?: boolean;
};

type WooProduct = { id: number; sku?: string; regular_price?: string };

/* ======================================================================
   Hjälpfunktioner
====================================================================== */
function roundToStep(v: number, step: number, mode: "near" | "up" | "down" | "none"): number {
  if (!step || step <= 0 || mode === "none") return v;
  const m = v / step;
  if (mode === "near") return Math.round(m) * step;
  if (mode === "up") return Math.ceil(m) * step;
  return Math.floor(m) * step;
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).slice(0, 5).join("\n");
  const candidates: Record<string, number> = {
    ",": (first.match(/,/g) || []).length,
    ";": (first.match(/;/g) || []).length,
    "\t": (first.match(/\t/g) || []).length,
  };
  const best = Object.entries(candidates).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

function normalizeHeader(h: string): string {
  return String(h || "")
    .replace(/\uFEFF/g, "") // BOM
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// accepterade rubriknamn (ordnings-oberoende)
const SKU_KEYS   = ["part no", "partno", "part_no", "sku", "code", "part number"];
const PRICE_KEYS = ["price", "gbp", "rrp"];

// plocka SKU ur en rad
function pickSku(row: Record<string, string>): string {
  for (const k of SKU_KEYS) {
    if (k in row) {
      const v = String(row[k] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

// plocka pris (GBP) ur en rad
function pickGbp(row: Record<string, string>): number {
  for (const k of PRICE_KEYS) {
    if (k in row) {
      const raw = String(row[k] ?? "").replace(",", ".").trim();
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

// läs JSON från WooCommerce-respons, men tolerera HTML-fel
async function readJsonSafe(res: Response): Promise<{ json: any; text: string }> {
  const text = await res.text();
  try {
    return { json: text ? JSON.parse(text) : null, text };
  } catch {
    return { json: null, text };
  }
}

/* ======================================================================
   Azure Function
====================================================================== */
app.http("price-upload", {
  route: "price-upload",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") return { status: 200, headers: cors };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "price-upload" }, headers: cors };

    try {
      // ---- läs body ----
      let body: UploadBody;
      try {
        body = (await req.json()) as UploadBody;
      } catch (e) {
        return { status: 400, jsonBody: { error: "Body is not valid JSON" }, headers: cors };
      }
      if (!body?.base64) return { status: 400, jsonBody: { error: "Missing base64 CSV" }, headers: cors };

      // parametrar / default
      const fx         = Number(body.fx ?? 13.0);
      const markupPct  = Number(body.markupPct ?? 0);
      const step       = Number(body.step ?? 1);
      const roundMode  = (body.roundMode ?? "near") as "near" | "up" | "down" | "none";
      const publish    = !!body.publish;
      const dryRun     = !!body.dryRun;

      // ---- base64 -> text (utf8, fallback latin1) ----
      const buf = Buffer.from(body.base64, "base64");
      let csvText = "";
      try {
        csvText = buf.toString("utf8");
        if ((csvText.match(/\uFFFD/g) || []).length > 10) csvText = buf.toString("latin1");
      } catch {
        csvText = buf.toString("latin1");
      }

      const delimiter = detectDelimiter(csvText);

      // ---- parse CSV: ordnings-oberoende rubriker ----
      const records = parse(csvText, {
        delimiter,
        bom: true,
        columns: (headers: string[]) => headers.map(normalizeHeader),
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        trim: true,
      }) as Record<string, string>[];

      const rows = records.filter(r => Object.values(r).some(v => String(v ?? "").trim().length));

      // ---- ackumulatorer ----
      let updated = 0, skipped = 0, notFound = 0, badRows = 0;
      const errors: Array<{ sku?: string; error?: string; reason?: string; row?: number }> = [];
      const sample = { updates: [] as Array<{ id: number; sku: string; to: string; from?: string }>,
                       errors:  [] as Array<any> };

      // ---- bearbeta rader ----
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i] || {};
        try {
          const sku = pickSku(raw);
          const priceGBP = pickGbp(raw);

          if (!sku) {
            skipped++;
            if (sample.errors.length < 5) sample.errors.push({ row: i + 1, reason: "missing sku" });
            continue;
          }
          if (!Number.isFinite(priceGBP)) {
            skipped++;
            if (sample.errors.length < 5) sample.errors.push({ row: i + 1, sku, reason: "missing/invalid price" });
            continue;
          }

          const priceSEK = roundToStep(priceGBP * fx * (1 + markupPct / 100), step, roundMode);
          const priceStr = priceSEK.toFixed(2);

          // Woo: hitta produkt på SKU
          const resFind = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
          const { json: findJson, text: findText } = await readJsonSafe(resFind);

          if (!resFind.ok) {
            errors.push({ sku, error: `Woo /products?sku HTTP ${resFind.status}: ${findText.slice(0, 180)}` });
            if (sample.errors.length < 5) sample.errors.push({ sku, error: `HTTP ${resFind.status}` });
            continue;
          }
          if (!Array.isArray(findJson)) {
            errors.push({ sku, error: `Woo /products?sku unexpected payload: ${findText.slice(0, 180)}` });
            if (sample.errors.length < 5) sample.errors.push({ sku, error: "unexpected payload" });
            continue;
          }
          if (findJson.length === 0) {
            notFound++;
            if (sample.errors.length < 5) sample.errors.push({ sku, reason: "not found" });
            continue;
          }

          const product: WooProduct = findJson[0];
          const id = product.id;

          if (dryRun) {
            updated++;
            if (sample.updates.length < 5) sample.updates.push({ id, sku, to: priceStr, from: product.regular_price });
            continue;
          }

          const payload: any = { regular_price: priceStr };
          if (publish) payload.status = "publish";

          const resUpd = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
          const { text: updText } = await readJsonSafe(resUpd);
          if (!resUpd.ok) {
            errors.push({ sku, error: updText || `update failed HTTP ${resUpd.status}` });
            if (sample.errors.length < 5) sample.errors.push({ sku, error: "update failed" });
            continue;
          }

          updated++;
          if (sample.updates.length < 5) sample.updates.push({ id, sku, to: priceStr, from: product.regular_price });
        } catch (e: any) {
          badRows++;
          if (sample.errors.length < 5) sample.errors.push({ row: i + 1, error: e?.message || String(e) });
        }
      }

      // ---- svar ----
      return {
        status: 200,
        jsonBody: {
          ok: true,
          filename: body.filename || null,
          total: rows.length,
          updated,
          skipped,
          notFound,
          badRows,
          errors: errors.length,
          sample,
          detail: {
            updatedSkus: sample.updates.map(u => u.sku),
            notFoundSkus: sample.errors.filter((e: any) => e?.reason === "not found").map((e: any) => e.sku).filter(Boolean),
          },
        },
        headers: cors,
      };
    } catch (e: any) {
      ctx.error("price-upload failed", e);
      return { status: 500, jsonBody: { error: e?.message || "price-upload failed" }, headers: cors };
    }
  },
});