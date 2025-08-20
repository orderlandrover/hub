// api/price-upload/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from "xlsx";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

type RoundMode = "near" | "up" | "down";
type UploadBody = {
  filename: string;
  base64: string;      // filinnehåll (ren base64, inga data:...-prefix)
  fx: number;          // GBP -> SEK (t.ex. 13.45)
  markupPct: number;   // t.ex. 25
  roundMode: RoundMode;// "near" | "up" | "down"
  step: number;        // t.ex. 1, 5, 10
  publish?: boolean;   // sätt publish direkt
  dryRun?: boolean;    // bara räkna, skriv inte till WC
};

type Row = { sku: string; gbp: number };

function decodeBase64ToUint8Array(b64: string) {
  // Tillåt att någon råkat skicka data-URL
  const clean = b64.includes(",") ? b64.split(",").pop()! : b64;
  const bin = Buffer.from(clean, "base64");
  return new Uint8Array(bin);
}

function smartHeaders(v: any): Row | null {
  if (!v || typeof v !== "object") return null;

  const keys = Object.keys(v);
  const norm = (s: string) => String(s).trim().toLowerCase();

  // leta “sku”, “part”, “part number”, “code”, “artikel”, “artnr”
  const skuKey = keys.find(k => /^(sku|part|part\s*number|code|artikel|artnr)$/i.test(norm(k)));
  // leta pris – gärna med “gbp”
  const priceKey =
    keys.find(k => /(gbp)/i.test(norm(k))) ??
    keys.find(k => /(price|pris)/i.test(norm(k)));

  const sku = (skuKey ? String(v[skuKey]) : "").trim();
  const gbpRaw = priceKey ? v[priceKey] : undefined;
  const gbp = Number(String(gbpRaw ?? "").replace(",", "."));

  if (!sku || !isFinite(gbp)) return null;
  return { sku, gbp };
}

function roundToStep(value: number, step: number, mode: RoundMode): number {
  if (!isFinite(value)) return 0;
  if (step <= 0) return Math.round(value * 100) / 100;
  const q = value / step;
  const r =
    mode === "up" ? Math.ceil(q) :
    mode === "down" ? Math.floor(q) :
    Math.round(q);
  return r * step;
}

app.http("price-upload", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const log = (...a: any[]) => ctx.log("[price-upload]", ...a);
    try {
      assertEnv();

      // --- 1) Läs body + validera ---
      const body = (await req.json()) as UploadBody;

      if (!body?.filename || !body?.base64) {
        return { status: 400, jsonBody: { error: "filename och base64 krävs" } };
      }

      const fx = Number(body.fx);
      const markup = Number(body.markupPct) / 100;
      const step = Number(body.step || 1);
      const mode: RoundMode = (body.roundMode as RoundMode) || "near";
      const dryRun = !!body.dryRun;
      const publish = !!body.publish;

      if (!isFinite(fx) || fx <= 0) {
        return { status: 400, jsonBody: { error: "Ogiltig valutakurs (fx)" } };
      }

      // --- 2) Läs arbetsbok ---
      let rows: any[] = [];
      try {
        const u8 = decodeBase64ToUint8Array(body.base64);
        const wb = XLSX.read(u8, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: "" }) as any[];
      } catch (e: any) {
        log("XLSX parse error:", e?.message || e);
        return { status: 400, jsonBody: { error: "Kunde inte läsa filen som Excel/CSV" } };
      }

      // --- 3) Extrahera (sku, gbp) ---
      const parsed: Row[] = rows.map(smartHeaders).filter((x): x is Row => !!x);
      if (parsed.length === 0) {
        return { status: 400, jsonBody: { error: "Hittade inga rader med SKU och GBP" } };
      }

      // --- 4) Kör igenom raderna (sekventiellt, enklare att felsöka) ---
      const updates: any[] = [];
      const skipped: any[] = [];
      const notFound: string[] = [];
      const errors: { sku: string; error: string }[] = [];

      for (const r of parsed) {
        try {
          // Hitta produkt via SKU
          const resList = await wcRequest(`/products?sku=${encodeURIComponent(r.sku)}`);
          const list = await resList.json();
          const p = Array.isArray(list) ? list[0] : null;

          if (!p) {
            notFound.push(r.sku);
            continue;
          }

          const current = Number(p?.regular_price ?? 0);
          const sek = roundToStep(r.gbp * fx * (1 + markup), step, mode);
          const next = Number(sek.toFixed(2));

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

      // --- 5) Svar ---
      const res = {
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
      };
      log("Result:", res);
      return { jsonBody: res };
    } catch (e: any) {
      ctx.error("[price-upload] Fatal:", e?.message || e);
      return { status: 500, jsonBody: { error: e?.message || "Okänt fel" } };
    }
  },
});