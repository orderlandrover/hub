import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch, readJsonSafe } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function parseIntSafe(v: string | null | undefined, def = 10, min = 1, max = 100): number {
  if (!v) return def;
  const m = /(\d+)/.exec(v);
  const n = m ? Number(m[1]) : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function toNum(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Normalisera pris från wc/v3 (strängar) och ev. Store-API-format. */
function pickPrice(p: any): number | null {
  // wc/v3: price, regular_price, sale_price (alla som strängar)
  // Store API (ibland): prices.price / prices.regular_price / prices.sale_price
  return (
    toNum(p?.price) ??
    toNum(p?.regular_price) ??
    toNum(p?.sale_price) ??
    toNum(p?.prices?.price) ??
    toNum(p?.prices?.regular_price) ??
    toNum(p?.prices?.sale_price) ??
    null
  );
}

app.http("products-list", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "products-list",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      // Stöd BÅDE nya och gamla param-namn
      const q        = (req.query.get("search") ?? req.query.get("q") ?? "").trim();
      const statusIn = (req.query.get("status") ?? "").trim();                 // publish|draft|any
      const category = (req.query.get("category") ?? "").trim();
      const orderby  = (req.query.get("orderby") ?? req.query.get("sortBy") ?? "title").trim();
      const order    = (req.query.get("order") ?? req.query.get("sortDir") ?? "asc").trim().toLowerCase();
      const page     = Number(req.query.get("page") ?? req.query.get("p") ?? "1");
      const perPage  = parseIntSafe(req.query.get("per_page") ?? req.query.get("s"), 100, 1, 100);

      const usp = new URLSearchParams();
      usp.set("per_page", String(perPage));
      usp.set("page", String(Math.max(1, page)));

      if (q) usp.set("search", q);

      if (statusIn && statusIn !== "any" && statusIn !== "Alla" && statusIn !== "all") {
        // UI kan skicka svenska – mappa till Woo
        const map: Record<string, string> = { "Publicerad": "publish", "Utkast": "draft" };
        usp.set("status", map[statusIn] ?? statusIn);
      }

      if (category && category !== "Alla" && !Number.isNaN(Number(category))) {
        usp.set("category", String(Number(category)));
      }

      const orderbyMap: Record<string, string> = {
        title: "title",
        price: "price",
        date:  "date",
        id:    "id",
        slug:  "slug",
      };
      usp.set("orderby", orderbyMap[orderby] ?? "title");
      usp.set("order", order === "desc" ? "desc" : "asc");

      // OBS: vi låter bli _fields här för att slippa riskera att Woo klipper bort något vi behöver
      const url = `/wp-json/wc/v3/products?${usp.toString()}`;
      const res = await wcFetch(url);
      const items = await readJsonSafe<any[]>(res);

      const total = Number(res.headers.get("x-wp-total") ?? "0");
      const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "0");

      const rows = (items ?? []).map((p) => ({
        id: Number(p.id),
        sku: String(p.sku ?? ""),
        name: String(p.name ?? ""),
        // nytt: numeriskt pris som tabellen kan visa direkt
        price: pickPrice(p),                           // <— ANVÄND DETTA I UI
        // kvar för bakåtkompatibilitet/visning
        regular_price: p.regular_price ?? (p.price ? String(p.price) : undefined),
        stock_quantity: p.stock_quantity ?? null,
        stock_status: p.stock_status ?? null,
        status: String(p.status ?? ""),
        categories: Array.isArray(p.categories) ? p.categories : [],
        images: Array.isArray(p.images) ? p.images : [],
      }));

      return {
        status: 200,
        headers: CORS,
        jsonBody: { items: rows, total, pages: totalPages, page: Math.max(1, page) },
      };
    } catch (e: any) {
      ctx.error?.("products-list error", e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message ?? e) } };
    }
  },
});
