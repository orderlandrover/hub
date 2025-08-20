import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from "xlsx";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

type RoundMode = "near" | "up" | "down";
type UploadBody = {
  filename: string;
  base64: string;       // filinnehåll (base64)
  fx: number;           // GBP -> SEK
  markupPct: number;    // t.ex. 25
  roundMode: RoundMode; // "near" | "up" | "down"
  step: number;         // t.ex. 1, 5, 10
  publish?: boolean;
  dryRun?: boolean;
};

type Row = { sku: string; gbp: number };

/* ---------- helpers ---------- */
function fromBase64ToBuffer(b64: string) {
  return Buffer.from(b64, "base64");
}
function fromBase64ToUtf8(b64: string) {
  return Buffer.from(b64, "base64").toString("utf8");
}
function asNumberLike(v: any): number {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/\s+/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** CSV-split som hanterar citattecken och valfri avgränsare */
function splitCSVLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } // escaped "
      else q = !q;
      continue;
    }
    if (!q && ch === delim) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/** Automatisk CSV-avgränsare + hantera "sep=;"-rad */
function parseCSV(text: string): any[] {
  let src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Ta bort ev BOM
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);

  let delim = ",";
  if (/^sep=./i.test(src)) {
    const first = src.split("\n", 1)[0];
    delim = first.slice(4, 5) || ",";
    src = src.slice(first.length + 1);
  } else {
    // auto: välj den som verkar användas mest
    const first = src.split("\n", 1)[0] || "";
    const c = (s: string) => (first.match(new RegExp(`\\${s}`, "g")) || []).length;
    const counts = [{d:",",n:c(",")},{d:";",n:c(";")},{d:"\t",n:c("\t")}];
    counts.sort((a,b)=>b.n-a.n);
    if (counts[0].n > 0) delim = counts[0].d;
  }

  const lines = src.split("\n").filter(l => l.length > 0);
  if (lines.length === 0) return [];

  const header = splitCSVLine(lines[0], delim);
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delim);
    const o: any = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = cols[j];
    rows.push(o);
  }
  return rows;
}

function smartRow(v: any): Row | null {
  if (!v || typeof v !== "object") return null;
  const keys = Object.keys(v);

  // hitta SKU
  const skuKey = keys.find(k =>
    /^(sku|part|part\s*number|code|artikel|artnr)$/i.test(String(k).trim())
  );
  // hitta GBP
  const priceKey = keys.find(k =>
    /(gbp|price.*gbp|pris.*gbp|price|pris)/i.test(String(k).trim())
  );

  const sku = (skuKey ? String(v[skuKey]) : "").trim();
  const gbp = asNumberLike(priceKey ? v[priceKey] : undefined);

  if (!sku || !Number.isFinite(gbp)) return null;
  return { sku, gbp };
}

function roundToStep(value: number, step: number, mode: RoundMode): number {
  if (!Number.isFinite(value)) return value;
  if (step <= 0) return Math.round(value * 100) / 100;
  const q = value / step;
  let r: number;
  switch (mode) {
    case "up":   r = Math.ceil(q);  break;
    case "down": r = Math.floor(q); break;
    default:     r = Math.round(q); // near
  }
  return r * step;
}

/* ---------- Function ---------- */
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

      const fx = asNumberLike(body.fx);
      const markup = asNumberLike(body.markupPct) / 100;
      const step = asNumberLike(body.step);
      const mode: RoundMode = (body.roundMode as RoundMode) || "near";
      const dryRun = !!body.dryRun;

      if (!Number.isFinite(fx) || fx <= 0) {
        return { status: 400, jsonBody: { error: "Ogiltig valutakurs (fx)" } };
      }

      // 1) Läs rader
      let rawRows: any[] = [];
      const lower = body.filename.toLowerCase();

      if (lower.endsWith(".csv")) {
        // CSV → egen parser (workaround för xlsx-stack overflow)
        const text = fromBase64ToUtf8(body.base64);
        rawRows = parseCSV(text);
      } else {
        // XLS/XLSX → xlsx via Buffer + type:"buffer"
        const buf = fromBase64ToBuffer(body.base64);
        const wb = XLSX.read(buf, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error("Kunde inte hitta första bladet i arbetsboken.");
        rawRows = XLSX.utils.sheet_to_json(ws);
      }

      // 2) (sku,gbp)
      const parsed: Row[] = rawRows.map(smartRow).filter((x): x is Row => !!x);
      if (parsed.length === 0) {
        return { status: 400, jsonBody: { error: "Kunde inte tolka filen (hittade inga SKU/GBP)" } };
      }

      // 3) Bearbeta
      const updates: any[] = [];
      const skipped: any[] = [];
      const notFound: string[] = [];
      const errors: { sku: string; error: string }[] = [];

      for (const r of parsed) {
        try {
          // WooCommerce lookup via SKU
          const resList = await wcRequest(`/products?sku=${encodeURIComponent(r.sku)}`);
          const list = await resList.json();
          const p = Array.isArray(list) && list[0];

          if (!p) { notFound.push(r.sku); continue; }

          const current = Number(p?.regular_price ?? 0);
          const sekRaw = r.gbp * fx * (1 + (Number.isFinite(markup) ? markup : 0));
          const sek = roundToStep(sekRaw, Number.isFinite(step) ? step : 1, mode);
          const next = Number(sek.toFixed(2));

          if (Number.isFinite(current) && Math.abs(current - next) < 0.009) {
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
          fileType: lower.endsWith(".csv") ? "csv" : "xlsx",
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
      // Viktigt: returnera *konkret* feltext så vi ser exakt var det small
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || String(e) } };
    }
  },
});