import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from "xlsx";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

type RoundMode = "near" | "up" | "down";
type UploadBody = {
  filename: string;
  base64: string;       // filinnehåll base64 (dataURL-delen, utan "data:*;base64,")
  fx: number;           // GBP -> SEK
  markupPct: number;    // t.ex. 25
  roundMode?: string;   // "near" | "up" | "down" (andra värden mappas till "near")
  step?: number;        // t.ex. 1, 5, 10
  publish?: boolean;    // publish direkt
  dryRun?: boolean;     // visa bara vad som skulle uppdateras
};

type Row = { sku: string; gbp: number };

// ---- helpers ----
function b64ToUint8Array(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function toNumberLike(x: any): number {
  if (x == null) return NaN;
  const s = String(x).replace(/[^\d.,\-]/g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

function pickHeaders(v: any): Row | null {
  if (!v || typeof v !== "object") return null;
  const keys = Object.keys(v);

  // SKU
  const skuKey = keys.find((k) =>
    /^(sku|part(\s*number)?|code|artikel|artnr)$/i.test(String(k).trim())
  );
  // Pris
  const priceKey = keys.find((k) =>
    /(gbp|price.*gbp|pris.*gbp|price|pris)/i.test(String(k).trim())
  );

  const sku = (skuKey ? String(v[skuKey]) : "").trim();
  const gbp = toNumberLike(priceKey ? v[priceKey] : undefined);

  if (!sku || !isFinite(gbp)) return null;
  return { sku, gbp };
}

function roundToStep(value: number, step: number, mode: RoundMode): number {
  if (!isFinite(value)) return value;
  if (!isFinite(step) || step <= 0) {
    // normal 2-decimalers avrundning om inget steg
    return Math.round(value * 100) / 100;
  }
  const q = value / step;
  let r: number;
  switch (mode) {
    case "up":   r = Math.ceil(q); break;
    case "down": r = Math.floor(q); break;
    default:     r = Math.round(q); // near
  }
  return r * step;
}

// ---- function ----
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
      const dryRun = !!body.dryRun;
      const publish = !!body.publish;

      if (!isFinite(fx) || fx <= 0) {
        return { status: 400, jsonBody: { error: "Ogiltig valutakurs (fx)" } };
      }

      // mappa roundMode
      const rm = String(body.roundMode || "").toLowerCase();
      const roundMode: RoundMode = (rm === "up" ? "up" : rm === "down" ? "down" : "near");

      // 1) Läs arbetsbok från base64
      const u8 = b64ToUint8Array(body.base64);
      const ext = (body.filename.split(".").pop() || "").toLowerCase();
      let wb: XLSX.WorkBook;

      try {
        // XLSX klarar både CSV och XLSX via read(array)
        wb = XLSX.read(u8, { type: "array", raw: true });
      } catch (e) {
        // fallback om det ändå blir fel: prova att tolka som UTF-8-text (CSV)
        const asText = Buffer.from(u8).toString("utf8");
        wb = XLSX.read(asText, { type: "string", raw: true });
      }

      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return { status: 400, jsonBody: { error: "Kunde inte läsa första arket i filen" } };

      // 2) Extrahera rader
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true }) as any[];
      const parsed: Row[] = raw.map(pickHeaders).filter((x): x is Row => !!x);

      if (parsed.length === 0) {
        return { status: 400, jsonBody: { error: "Kunde inte tolka filen (hittade inga SKU/GBP)" } };
      }

      // 3) Kör igenom poster
      const updates: any[] = [];
      const skipped: any[] = [];
      const notFound: string[] = [];
      const errors: { sku: string; error: string }[] = [];

      for (const r of parsed) {
        try {
          // Hitta produkt via SKU
          const listRes = await wcRequest(`/products?sku=${encodeURIComponent(r.sku)}`);
          const list = await listRes.json();
          const p = Array.isArray(list) && list[0];

          if (!p) { notFound.push(r.sku); continue; }

          // Beräkna SEK
          const prelim = r.gbp * fx * (1 + markup);
          const sek = roundToStep(prelim, step, roundMode);
          const next = Math.round(Number(sek) * 100) / 100; // 2 decimaler säkert
          const current = toNumberLike(p?.regular_price);

          // Ingen ändring?
          if (isFinite(current) && Math.abs(current - next) < 0.009) {
            skipped.push({ id: p.id, sku: r.sku, price: current });
            continue;
          }

          if (dryRun) {
            updates.push({ id: p.id, sku: r.sku, from: current, to: next, dryRun: true });
            continue;
          }

          // Uppdatera
          const patch: any = { regular_price: String(next) };
          if (publish) patch.status = "publish";

          const saveRes = await wcRequest(`/products/${p.id}`, {
            method: "PUT",
            body: JSON.stringify(patch),
          });
          const saved = await saveRes.json();
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
      // Skicka tydligt fel till UI:t
      req && ctx && ctx.error?.(e);
      return { status: 500, jsonBody: { error: e?.message || "Okänt fel i price-upload" } };
    }
  },
});