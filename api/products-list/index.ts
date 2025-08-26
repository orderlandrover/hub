// api/products-list/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch, readJsonSafe } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function parsePerPage(s: string | null): number {
  // UI verkar skicka t.ex. "per-page-10". Tillåt även rena tal.
  if (!s) return 10;
  const m = /(\d+)/.exec(s);
  return m ? Math.max(1, Math.min(100, Number(m[1]))) : 10;
}

app.http("products-list", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "products-list",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const q = req.query.get("q") ?? "";                 // söktext (sku eller namn)
      const status = req.query.get("status") ?? "";       // 'publish'|'draft'|'' (alla)
      const category = req.query.get("category") ?? "";   // category id (string)
      const sortBy = req.query.get("sortBy") ?? "title";  // 'title'|'price'|'date' etc.
      const sortDir = (req.query.get("sortDir") ?? "asc").toLowerCase(); // 'asc'|'desc'
      const p = Number(req.query.get("p") ?? "1");        // page
      const s = req.query.get("s");                       // perPage in UI-format
      const perPage = parsePerPage(s);

      const usp = new URLSearchParams();
      usp.set("per_page", String(perPage));
      usp.set("page", String(Math.max(1, p)));

      // Sök: Woo stöder "search"
      if (q) usp.set("search", q);

      // Status-filtrering
      if (status && status !== "Alla" && status !== "all") {
        // översätt svensk UI till Woo-status
        const map: Record<string, string> = { "Publicerad": "publish", "Utkast": "draft" };
        usp.set("status", map[status] ?? status);
      }

      // Kategori
      if (category && category !== "Alla" && !Number.isNaN(Number(category))) {
        usp.set("category", String(Number(category)));
      }

      // Sortering
      // Woo: orderby = 'date'|'id'|'include'|'title'|'slug'|'price'|'popularity'|'rating'
      const orderbyMap: Record<string, string> = {
        title: "title",
        price: "price",
        date: "date",
        id: "id",
      };
      usp.set("orderby", orderbyMap[sortBy] ?? "title");
      usp.set("order", sortDir === "desc" ? "desc" : "asc");

      // Hämta
      const url = `/wp-json/wc/v3/products?${usp.toString()}`;
      const res = await wcFetch(url);
      const items = await readJsonSafe<any[]>(res);

      // Total & pages via headers
      const total = Number(res.headers.get("x-wp-total") ?? "0");
      const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "0");

      // Minimera & normalisera för tabellen
      const rows = (items ?? []).map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        price: Number(p.price ?? 0),
        stock_quantity: p.stock_quantity ?? null,
        stock_status: p.stock_status ?? null,
        status: p.status,                       // publish/draft/…
        categories: Array.isArray(p.categories) ? p.categories.map((c: any) => c.name).join(", ") : "",
        category_ids: Array.isArray(p.categories) ? p.categories.map((c: any) => c.id) : [],
        image: p.images?.[0]?.src ?? null,
      }));

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          total,
          pages: totalPages,
          perPage,
          page: Math.max(1, p),
          items: rows,
        },
      };
    } catch (e: any) {
      ctx.error("products-list error", e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message ?? e) } };
    }
  },
});