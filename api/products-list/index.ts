import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

type WCProduct = {
  id: number;
  name: string;
  sku: string;
  status: string;
  regular_price?: string;
  stock_quantity?: number | null;
  stock_status?: string;
  categories?: { id: number; name?: string }[];
  images?: { src: string }[];
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

app.http("products-list", {
  route: "products-list",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      // Query params från UI
      const page = Number(req.query.get("page") || "1");
      const per_page = Number(req.query.get("per_page") || "100");
      const orderby = (req.query.get("orderby") || "title") as "title" | "date" | "id" | "price";
      const order = (req.query.get("order") || "asc") as "asc" | "desc";
      const status = req.query.get("status") || "";        // "", "publish", "draft", …
      const search = (req.query.get("search") || "").trim();
      const category = req.query.get("category") || "";    // id som string

      const qs = new URLSearchParams({
        page: String(page),
        per_page: String(Math.min(Math.max(per_page, 1), 100)), // Woo max 100
        orderby,
        order,
        // bättre feltolerans på Woo
        "hide_empty": "false",
      });

      if (status && status !== "any") qs.set("status", status);
      if (search) qs.set("search", search);
      if (category) qs.set("category", category);

      // Hämtning
      const res = await wcFetch(`/products?${qs.toString()}`);
      const text = await res.text();

      // Fånga icke‑JSON svar (t.ex. HTML fel från WP)
      let items: WCProduct[] = [];
      try {
        items = JSON.parse(text);
      } catch {
        throw new Error(`Woo /products returned non‑JSON (status ${res.status}). Snippet: ${text.slice(0, 200)}`);
      }

      if (!res.ok) {
        throw new Error(`Woo /products HTTP ${res.status}. Body: ${text.slice(0, 500)}`);
      }

      // Pagination info från headers
      const total = Number(res.headers.get("x-wp-total") || items.length || 0);
      const pages = Number(res.headers.get("x-wp-totalpages") || 1);

      return {
        status: 200,
        jsonBody: { items, total, pages, page },
        headers: CORS,
      };
    } catch (e: any) {
      // yta fel till UI så vi slipper “Något gick fel” utan detalj
      ctx.error("products-list failed", e);
      return {
        status: 500,
        jsonBody: { error: e?.message || String(e) },
        headers: CORS,
      };
    }
  },
});