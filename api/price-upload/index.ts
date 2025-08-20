import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from "xlsx";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

type Body = {
  filename: string;
  base64: string;
  publish?: boolean;
  dryRun?: boolean;
  fxRate: number;         // GBP->SEK
  markupPct: number;      // %
  roundMode: "nearest"|"up"|"down"|"none";
  roundStep: number;      // 1|5|10...
  wcCategoryIds?: number[]; // valfri filtrering
};

type Row = Record<string, any>;

function normKey(k: string) {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SKU_KEYS = ["sku","part","partno","partnumber","partcode","code","item","pn","partn","partnum"];
const PRICE_KEYS = ["price","gbp","retail","retailprice","rrp","net","unitprice","exvat","listprice"];

function findKey(row: Row, candidates: string[]) {
  const map: Record<string,string> = {};
  Object.keys(row || {}).forEach(k => map[normKey(k)] = k);
  for (const c of candidates) {
    const hit = map[normKey(c)];
    if (hit) return hit;
  }
  // sista utväg: första numeriska kolumn som ser ut som pris
  for (const [k,v] of Object.entries(row || {})) {
    if (typeof v === "number") return k;
    if (typeof v === "string" && v.match(/\d/)) return k;
  }
  return "";
}

function parseGBP(v: any): number {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  const s = String(v).replace(/[^\d.,-]/g,"").replace(",",".");
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

function applyRounding(x: number, mode: Body["roundMode"], step: number): number {
  if (step <= 0 || mode === "none") return Math.round(x);
  const q = x / step;
  if (mode === "nearest") return Math.round(q) * step;
  if (mode === "up")      return Math.ceil(q)  * step;
  if (mode === "down")    return Math.floor(q) * step;
  return Math.round(x);
}

async function fetchAllProducts(): Promise<any[]> {
  const all: any[] = [];
  for (let page=1;; page++) {
    const res = await wcRequest(`/products?per_page=100&page=${page}`);
    const items = await res.json();
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out;
}

app.http("price-upload", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const b = await req.json() as Body;
      if (!b?.base64 || !b?.filename) return { status: 400, jsonBody: { error: "filename + base64 krävs" } };
      if (!b.fxRate || b.fxRate <= 0)  return { status: 400, jsonBody: { error: "fxRate måste vara > 0" } };

      // 1) Läs filen (första bladet / CSV)
      const buf = Buffer.from(b.base64, "base64");
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null });

      if (!rows.length) return { status: 400, jsonBody: { error: "Tom fil" } };

      // 2) Hitta kolumnnamn
      const sk = findKey(rows[0], SKU_KEYS);
      const pk = findKey(rows[0], PRICE_KEYS);
      if (!sk || !pk) {
        return { status: 400, jsonBody: { error: `Kunde inte hitta SKU/priskolumn (hittade SKU='${sk}', pris='${pk}')` } };
      }

      // 3) Bygg karta över WC-produkter (sku->product)
      const all = await fetchAllProducts();
      const bySku = new Map<string, any>();
      all.forEach(p => { if (p?.sku) bySku.set(String(p.sku).trim().toUpperCase(), p); });

      // Filter på WC-kategori om angivet
      const wcSet = new Set<number>((b.wcCategoryIds || []).map(Number));

      // 4) Räkna om priser
      const updates: any[] = [];
      const sample: any[] = [];
      let matched = 0;

      for (const r of rows) {
        const rawSku = r[sk];
        const rawGbp = r[pk];

        const sku = rawSku == null ? "" : String(rawSku).trim().toUpperCase();
        const gbp = parseGBP(rawGbp);
        if (!sku || !isFinite(gbp)) continue;

        const wc = bySku.get(sku);
        if (!wc) continue; // ej i WC
        matched++;

        if (wcSet.size) {
          const ids = (wc.categories || []).map((c:any)=>Number(c?.id)).filter(Boolean);
          if (!ids.some((id:number)=>wcSet.has(id))) continue; // filtrerad bort
        }

        const base = gbp * b.fxRate * (1 + (b.markupPct || 0)/100);
        const sek  = applyRounding(base, b.roundMode, b.roundStep || 1);
        const curr = Number(wc.regular_price ?? wc.price ?? 0);

        updates.push({ id: wc.id, regular_price: String(sek) });
        if (sample.length < 10) sample.push({ sku, id: wc.id, gbp, old: curr, new: sek });
      }

      // 5) Dry-run eller uppdatera i batchar
      if (b.dryRun) {
        return {
          jsonBody: {
            dryRun: true,
            totalRows: rows.length,
            matched,
            wouldUpdate: updates.length,
            sample
          }
        };
      }

      let updated = 0;
      for (const part of chunk(updates, 100)) {
        const res = await wcRequest(`/products/batch`, {
          method: "POST",
          body: JSON.stringify({ update: part })
        });
        const j = await res.json();
        updated += (j?.update?.length || 0);
      }

      return {
        jsonBody: {
          ok: true,
          totalRows: rows.length,
          matched,
          updated,
          sample
        }
      };

    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});