import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from "xlsx";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

type RoundMode = "near" | "up" | "down";
type UploadBody = {
  filename: string;
  base64: string;              // filinnehåll base64
  fx: number;                  // GBP -> SEK
  markupPct: number;           // t.ex. 25
  roundMode: RoundMode;        // "near" | "up" | "down"
  step: number;                // t.ex. 1, 5, 10
  publish?: boolean;           // om vi vill sätta publish samtidigt (valfritt)
  dryRun?: boolean;            // true => skriv inte till WC
};

type Row = { sku: string; gbp: number };

function decodeBase64ToUint8Array(b64: string) {
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}

function smartHeaders(v: any): Row | null {
  if (!v) return null;
  // Försök hitta SKU-kolumn
  const keys = Object.keys(v);
  const skuKey = keys.find(k =>
    /^(sku|part|part\s*number|code|artikel|artnr)$/i.test(String(k).trim())
  );
  // Försök hitta pris i GBP
  const priceKey = keys.find(k =>
    /(gbp|price.*gbp|pris.*gbp|price|pris)/i.test(String(k).trim())
  );

  const sku = (skuKey ? String(v[skuKey]) : "").trim();
  const gbpRaw = priceKey ? v[priceKey] : undefined;
  const gbp = Number(String(gbpRaw).replace(",", "."));

  if (!sku || !isFinite(gbp)) return null;
  return { sku, gbp };
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

      // 1) Läs arbetsbok
      const u8 = decodeBase64ToUint8Array(body.base64);
      const wb = XLSX.read(u8, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws) as any[];

      // 2) Extrahera (sku, gbp) rader
      const parsed: Row[] = rows
        .map(smartHeaders)
        .filter((x): x is Row => !!x);

      if (parsed.length === 0) {
        return { status: 400, jsonBody: { error: "Kunde inte tolka filen (hittade inga SKU/GBP)" } };
      }

      // 3) Kör igenom posterna
      const updates: any[] = [];
      const skipped: any[] = [];
      const notFound: string[] = [];
      const errors: { sku: string; error: string }[] = [];

      for (const r of parsed) {
        try {
          // Hitta produkt via SKU (WooCommerce)
          const resList = await wcRequest(`/products?sku=${encodeURIComponent(r.sku)}`);
          const list = await resList.json();
          const p = Array.isArray(list) && list[0];

          if (!p) {
            notFound.push(r.sku);
            continue;
          }

          const current = Number(p?.regular_price ?? 0);
          const sek = roundToStep(r.gbp * fx * (1 + markup), step, mode);
          const next = Number(sek.toFixed(2));

          // Ingen ändring?
          if (isFinite(current) && Math.abs(current - next) < 0.009) {
            skipped.push({ id: p.id, sku: r.sku, price: current });
            continue;
          }

          // Dry-run => logga bara
          if (dryRun) {
            updates.push({ id: p.id, sku: r.sku, from: current, to: next, dryRun: true });
            continue;
          }

          // Uppdatera pris (+ ev status publish)
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
      }

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
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});