import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from "xlsx";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

// Stöd för fler varianter från UI:t
type RoundMode = "near" | "nearest" | "up" | "down" | "none";
type UploadBody = {
  filename: string;
  base64: string;       // ren base64 (inte dataURL)
  fx: number;           // GBP -> SEK
  markupPct: number;    // t.ex. 25
  roundMode: RoundMode; // "near" | "up" | "down" | "none" | "nearest"
  step: number;         // t.ex. 1, 5, 10 (ignoreras om 'none')
  publish?: boolean;
  dryRun?: boolean;
};

type Row = { sku: string; gbp: number };

function decodeBase64ToUint8Array(b64: string) {
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}

function numify(v: any): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/[£,\s]/g, "").replace(",", "."); // ta bort £, kommatecken, mellanslag
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function smartHeaders(v: any): Row | null {
  if (!v || typeof v !== "object") return null;
  const keys = Object.keys(v);

  // SKU/Artikel/Part/Code/Item/PartNumber
  const skuKey =
    keys.find(k => /^(sku|artikel|artnr|code|part|part\s*number|partnumber|item|item\s*number|itemnumber)$/i.test(String(k).trim())) ??
    keys.find(k => /^(pn|p\/n)$/i.test(String(k).trim()));

  // Pris i GBP (fångar "gbp", "price gbp", "list price", "price")
  const priceKey =
    keys.find(k => /(gbp|price.*gbp|pris.*gbp)/i.test(String(k).trim())) ??
    keys.find(k => /(list.*price|price|pris)/i.test(String(k).trim()));

  const rawSku = skuKey ? v[skuKey] : undefined;
  const sku = rawSku == null ? "" : String(rawSku).trim();
  const gbp = priceKey ? numify(v[priceKey]) : null;

  if (!sku || gbp == null) return null;
  return { sku, gbp };
}

function roundToStep(value: number, step: number, mode: RoundMode): number {
  if (mode === "none") return Math.round(value * 100) / 100;
  if (step <= 0) step = 1;
  const q = value / step;
  let r: number;
  switch (mode === "nearest" ? "near" : mode) {
    case "up":   r = Math.ceil(q); break;
    case "down": r = Math.floor(q); break;
    default:     r = Math.round(q); // "near" + fallback
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

      // 1) Läs arbetsbok (CSV/XLSX)
      const u8 = decodeBase64ToUint8Array(body.base64);
      const wb = XLSX.read(u8, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return { status: 400, jsonBody: { error: "Kunde inte läsa kalkylbladet" } };

      // 2) Till JSON
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
      const parsed: Row[] = rows.map(smartHeaders).filter((x): x is Row => !!x);
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
          // Hämta produkt via SKU i WooCommerce
          const resList = await wcRequest(`/products?sku=${encodeURIComponent(r.sku)}`);
          const list = await resList.json();
          const p = Array.isArray(list) && list[0];

          if (!p) { notFound.push(r.sku); continue; }

          const current = Number(p?.regular_price ?? 0);
          const sek = roundToStep(r.gbp * fx * (1 + markup), step, mode);
          const next = Number(sek.toFixed(2));

          // Ingen ändring?
          if (isFinite(current) && Math.abs(current - next) < 0.009) {
            skipped.push({ id: p.id, sku: r.sku, price: current });
            continue;
          }

          if (dryRun) {
            updates.push({ id: p.id, sku: r.sku, from: current, to: next, dryRun: true });
            continue;
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
      return { status: 500, jsonBody: { error: e.message || "Okänt fel i price-upload" } };
    }
  },
});