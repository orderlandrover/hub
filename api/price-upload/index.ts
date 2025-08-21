import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { parse } from "csv-parse/sync";
import { wcFetch, wcFetchWithOverride } from "../shared/wc";

type PriceRowRaw = Record<string, string>;

type UploadBody = {
  filename: string;
  base64: string;         // CSV i base64 (från UI)
  fx?: number;            // GBP->SEK
  markupPct?: number;     // påslag i %
  roundMode?: "near" | "up" | "down" | "none";
  step?: number;          // avrundning (SEK)
  publish?: boolean;
  dryRun?: boolean;
};

function roundToStep(v: number, step: number, mode: "near" | "up" | "down" | "none"): number {
  if (!step || step <= 0 || mode === "none") return v;
  const m = v / step;
  if (mode === "near") return Math.round(m) * step;
  if (mode === "up") return Math.ceil(m) * step;
  return Math.floor(m) * step;
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).slice(0, 3).join("\n");
  const counts = {
    ",": (first.match(/,/g) || []).length,
    ";": (first.match(/;/g) || []).length,
    "\t": (first.match(/\t/g) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

function normalizeHeader(h: string): string {
  return h.replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim();
}

function getSKU(row: Record<string, string>): string {
  return (row["Part No"] || row["PartNo"] || row["SKU"] || "").trim();
}
function getGBP(row: Record<string, string>): number {
  const s = (row["Price"] ?? row["GBP"] ?? row["RRP"] ?? "").toString().replace(",", ".").trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Läs JSON säkert; returnera även råtext om inte JSON */
async function readJsonSafe(res: Response): Promise<{ json: any | null; text: string }> {
  const text = await res.text();
  try {
    return { json: text ? JSON.parse(text) : null, text };
  } catch {
    return { json: null, text };
  }
}

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
      const body = (await req.json()) as UploadBody;
      if (!body?.base64) {
        return { status: 400, jsonBody: { error: "Missing base64 CSV" }, headers: cors };
      }

      const fx = Number(body.fx ?? 13.0);
      const markupPct = Number(body.markupPct ?? 0);
      const step = Number(body.step ?? 1);
      const roundMode: "near" | "up" | "down" | "none" =
        (["near", "up", "down", "none"] as const).includes((body.roundMode as any) ?? "near")
          ? ((body.roundMode as "near" | "up" | "down" | "none") ?? "near")
          : "near";
      const publish = !!body.publish;
      const dryRun = !!body.dryRun;

      // Base64 -> CSV‑text (UTF‑8, fallback latin1)
      const buf = Buffer.from(body.base64, "base64");
      let csvText = buf.toString("utf8");
      if ((csvText.match(/\uFFFD/g) || []).length > 10) csvText = buf.toString("latin1");

      const delimiter = detectDelimiter(csvText);

      const tmp = parse(csvText, {
        delimiter,
        bom: true,
        columns: (headers: string[]) => headers.map(normalizeHeader),
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        trim: true,
      }) as PriceRowRaw[];

      const rows = tmp.filter((r) => Object.values(r).some((v) => String(v || "").trim().length));

      let updated = 0, skipped = 0, notFound = 0, badRows = 0;
      const errors: Array<{ sku?: string; error: string }> = [];
      const sample = { updates: [] as any[], errors: [] as any[] };

      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i] || {};
        try {
          const sku = getSKU(raw);
          const priceGBP = getGBP(raw);
          if (!sku || !priceGBP) { skipped++; continue; }

          const priceSEK = roundToStep(priceGBP * fx * (1 + markupPct / 100), step, roundMode);
          const priceStr = priceSEK.toFixed(2);

          // 1) Hitta produkt
          const resFind = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
          const { json: findJson, text: findText } = await readJsonSafe(resFind);
          if (!resFind.ok) {
            throw new Error(`Woo /products?sku HTTP ${resFind.status}: ${findText.slice(0, 180)}`);
          }
          if (!Array.isArray(findJson)) {
            throw new Error(`Woo /products?sku unexpected payload: ${findText.slice(0, 180)}`);
          }
          if (findJson.length === 0) {
            notFound++;
            if (sample.errors.length < 5) sample.errors.push({ sku, reason: "not found" });
            continue;
          }

          const product = findJson[0];
          const id: number = product.id;

          // 2) Dry‑run?
          if (dryRun) {
            updated++;
            if (sample.updates.length < 5) sample.updates.push({ id, sku, from: product.regular_price, to: priceStr });
            continue;
          }

          // 3) Bygg payload innan PUT
          const payload: any = { regular_price: priceStr };
          if (publish) payload.status = "publish";

          // 4) Uppdatera (med override‑fallback)
          const resUpd = await wcFetchWithOverride(`/products/${id}`, "PUT", payload);
          const { json: updJson, text: updText } = await readJsonSafe(resUpd);
          if (!resUpd.ok) {
            errors.push({ sku, error: `Woo PUT ${resUpd.status}: ${updText.slice(0, 180)}` });
            if (sample.errors.length < 5) sample.errors.push({ sku, error: `PUT ${resUpd.status}` });
            continue;
          }

          updated++;
          if (sample.updates.length < 5) sample.updates.push({ id: updJson?.id ?? id, sku, to: priceStr });
        } catch (e: any) {
          badRows++;
          const msg = e?.message || String(e);
          if (sample.errors.length < 5) sample.errors.push({ row: i + 1, error: msg });
        }
      }

      return {
        status: 200,
        jsonBody: {
          ok: true,
          total: rows.length,
          updated,
          skipped,
          notFound,
          badRows,
          errors: errors.length,
          sample,
        },
        headers: cors,
      };
    } catch (e: any) {
      ctx.error("price-upload failed", e);
      return { status: 500, jsonBody: { error: e.message }, headers: cors };
    }
  },
});