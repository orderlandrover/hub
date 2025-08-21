import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from "xlsx";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

/** UI → API */
type RoundMode = "near" | "up" | "down";
type UploadBody = {
  filename: string;
  base64: string;            // Base64-innehåll (utan data:...-prefix)
  fx: number;                // GBP -> SEK
  markupPct: number;         // t.ex. 25
  roundMode?: string;        // "near" | "up" | "down" | annat => "near"
  step?: number;             // 1, 5, 10 ...
  publish?: boolean;         // publicera samtidigt
  dryRun?: boolean;          // true => skriv inte till WC
  onlySkus?: string[];       // valfritt: begränsa körning till dessa SKU (Part No)
};

type Row = { sku: string; gbp: number };

/* ----------------- helpers ----------------- */
function b64ToUint8Array(b64: string) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function toNumber(x: any): number {
  if (x == null) return NaN;
  const s = String(x).replace(/[^\d.,\-]/g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

/** Hittar rätt kolumner för Part No och Price i Britparts prisfil */
function pickRow(v: any): Row | null {
  if (!v || typeof v !== "object") return null;
  const keys = Object.keys(v);

  // SKU/Part No
  const skuKey =
    keys.find(k => /^(part\s*no\.?|partno|part_number|sku|code|artikel|artnr)$/i.test(String(k).trim())) ??
    null;

  // Pris (GBP)
  const priceKey =
    keys.find(k => /^(price|gbp|unit\s*price|pris(\s*\(gbp\))?)$/i.test(String(k).trim())) ??
    null;

  const sku = (skuKey ? String(v[skuKey]) : "").trim();
  const gbp = toNumber(priceKey ? v[priceKey] : undefined);

  if (!sku || !isFinite(gbp)) return null;
  return { sku, gbp };
}

function roundToStep(value: number, step: number, mode: RoundMode): number {
  if (!isFinite(value)) return value;
  if (!isFinite(step) || step <= 0) return Math.round(value * 100) / 100;
  const q = value / step;
  const r = mode === "up" ? Math.ceil(q) : mode === "down" ? Math.floor(q) : Math.round(q);
  return r * step;
}

/* ----------------- function ----------------- */
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

      const fx = Number(body.fx);
      const markup = Number(body.markupPct) / 100;
      const step = Number(body.step ?? 1);
      const publish = !!body.publish;
      const dryRun = !!body.dryRun;
      const onlySkus = Array.isArray(body.onlySkus) ? body.onlySkus.map(s => String(s).trim()).filter(Boolean) : [];
      if (!isFinite(fx) || fx <= 0) return { status: 400, jsonBody: { error: "Ogiltig valutakurs (fx)" } };

      const rm = String(body.roundMode || "").toLowerCase();
      const roundMode: RoundMode = rm === "up" ? "up" : rm === "down" ? "down" : "near";

      // 1) Läs arbetsbok (xlsx/csv) – robust
      const u8 = b64ToUint8Array(body.base64);
      let wb: XLSX.WorkBook;
      try {
        wb = XLSX.read(u8, { type: "array", raw: true });
      } catch {
        const asText = Buffer.from(u8).toString("utf8"); // CSV fallback
        wb = XLSX.read(asText, { type: "string", raw: true });
      }
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return { status: 400, jsonBody: { error: "Kunde inte läsa första arket i filen" } };

      // 2) Mappa rader -> (sku, gbp)
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true }) as any[];
      let parsed: Row[] = raw.map(pickRow).filter((x): x is Row => !!x);

      // Begränsa vid test
      if (onlySkus.length) {
        const set = new Set(onlySkus.map(s => s.toUpperCase()));
        parsed = parsed.filter(r => set.has(r.sku.toUpperCase()));
      }

      if (parsed.length === 0) {
        return { status: 400, jsonBody: { error: "Kunde inte tolka filen (hittade inga Part No/Price)" } };
      }

      // 3) Gå igenom och uppdatera
      const updates: any[] = [];
      const skipped: any[] = [];
      const notFound: string[] = [];
      const errors: { sku: string; error: string }[] = [];

      for (const r of parsed) {
        try {
          // Hämta produkt via SKU (Part No)
          let p: any = null;
          try {
            const resList = await wcRequest(`/products?sku=${encodeURIComponent(r.sku)}`);
            const list = await resList.json();
            p = Array.isArray(list) ? list[0] : null;
          } catch (err: any) {
            errors.push({ sku: r.sku, error: err?.message || String(err) });
            continue;
          }

          if (!p) { notFound.push(r.sku); continue; }

          // GBP -> SEK med markup och steg-avrundning
          const prelim = r.gbp * fx * (1 + markup);
          const sekRounded = roundToStep(prelim, step, roundMode);
          const next = Math.round(sekRounded * 100) / 100; // 2 dec
          const current = toNumber(p?.regular_price);

          if (isFinite(current) && Math.abs(current - next) < 0.009) {
            skipped.push({ id: p.id, sku: r.sku, price: current });
            continue;
          }

          if (dryRun) {
            updates.push({ id: p.id, sku: r.sku, from: current, to: next, dryRun: true });
            continue;
          }

          const patch: any = { regular_price: String(next) };
          if (publish) patch.status = "publish";

          try {
            const resPut = await wcRequest(`/products/${p.id}`, {
              method: "PUT",
              body: JSON.stringify(patch),
            });
            const saved = await resPut.json();
            updates.push({ id: saved.id, sku: r.sku, from: current, to: next });
          } catch (err: any) {
            errors.push({ sku: r.sku, error: err?.message || String(err) });
          }
        } catch (err: any) {
          errors.push({ sku: r.sku, error: err?.message || String(err) });
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
      return { status: 500, jsonBody: { error: e?.message || "Okänt fel i price-upload" } };
    }
  },
});