import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { parse } from "csv-parse/sync";
import { wcFetch } from "../shared/wc";

type PriceRow = {
  "Part No": string;
  "Description": string;
  "Price": string;
  "Per"?: string;
  "UOI"?: string;
  "Brand"?: string;
  "LR Retail"?: string;
  "Weight"?: string;
  "Length"?: string;
  "Width"?: string;
  "Thickness"?: string;
  "C of O"?: string;
  "EEC Commodity Code"?: string;
};

type UploadBody = {
  filename: string;
  base64: string;         // CSV som base64 (från din UI)
  fx?: number;            // GBP -> SEK
  markupPct?: number;     // påslag i %
  roundMode?: "near" | "up" | "down" | "none";
  step?: number;          // avrundningssteg i SEK
  publish?: boolean;      // publicera direkt
  dryRun?: boolean;       // kör utan att uppdatera Woo
};

function roundToStep(v: number, step: number, mode: "near" | "up" | "down" | "none"): number {
  if (!step || step <= 0 || mode === "none") return v;
  const m = v / step;
  if (mode === "near") return Math.round(m) * step;
  if (mode === "up") return Math.ceil(m) * step;
  return Math.floor(m) * step;
}

app.http("price-upload", {
  route: "price-upload",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return { status: 200, headers: cors };

    try {
      const body = (await req.json()) as UploadBody;

      if (!body?.base64) {
        return { status: 400, jsonBody: { error: "Missing base64 CSV" }, headers: cors };
      }

      // Parametrar
      const fx = Number(body.fx ?? 13.0);
      const markupPct = Number(body.markupPct ?? 0);
      const step = Number(body.step ?? 1);
      const roundMode = (body.roundMode as UploadBody["roundMode"]) ?? "near";
      const publish = !!body.publish;
      const dryRun = !!body.dryRun;

      // Decode base64 -> text CSV
      let csvText = "";
      try {
        csvText = Buffer.from(body.base64, "base64").toString("utf-8");
      } catch (e) {
        return { status: 400, jsonBody: { error: "Invalid base64 input" }, headers: cors };
      }

      // Parse CSV (med rad-typ)
      const rows = parse(csvText, { columns: true, skip_empty_lines: true }) as PriceRow[];

      // Summering
      let updated = 0;
      let skipped = 0;
      let notFound = 0;
      const errors: Array<{ sku?: string; error: string }> = [];
      const sample = { updates: [] as any[], errors: [] as any[] };

      for (const row of rows) {
        try {
          const sku = (row["Part No"] || "").trim();
          const priceGBP = Number.parseFloat(row["Price"] || "0");
          if (!sku || !priceGBP || !Number.isFinite(priceGBP)) {
            skipped++;
            continue;
          }

          // Beräkna SEK
          const raw = priceGBP * fx * (1 + markupPct / 100);
          const priceSEK = roundToStep(raw, step, roundMode);
          const priceStr = priceSEK.toFixed(2);

          // Hitta produkten på SKU
          const r = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
          const list = await r.json();
          if (!Array.isArray(list) || list.length === 0) {
            notFound++;
            if (sample.errors.length < 5) sample.errors.push({ sku, reason: "not found" });
            continue;
          }

          const product = list[0];
          const id = product.id;

          if (dryRun) {
            updated++; // räknas som “skulle uppdateras”
            if (sample.updates.length < 5) {
              sample.updates.push({ id, sku, from: product.regular_price, to: priceStr });
            }
            continue;
          }

          // Uppdatera Woo pris + ev. status
          const payload: any = { regular_price: priceStr };
          if (publish) payload.status = "publish";

          const upd = await wcFetch(`/products/${id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });

          if (upd.ok) {
            updated++;
            if (sample.updates.length < 5) {
              sample.updates.push({ id, sku, to: priceStr });
            }
          } else {
            const msg = await upd.text();
            errors.push({ sku, error: msg || "update failed" });
            if (sample.errors.length < 5) sample.errors.push({ sku, error: msg });
          }
        } catch (err: any) {
          errors.push({ error: err?.message || String(err) });
          if (sample.errors.length < 5) sample.errors.push({ error: err?.message || String(err) });
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