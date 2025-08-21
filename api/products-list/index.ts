import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("products-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const status = url.searchParams.get("status") || ""; // tom = alla
      const search = url.searchParams.get("search") || "";
      const category = url.searchParams.get("category") || "";
      const orderby = url.searchParams.get("orderby") || "title";
      const order = url.searchParams.get("order") || "asc";
      const per_page = parseInt(url.searchParams.get("per_page") || "100", 10);
      const source = url.searchParams.get("source") || ""; // t.ex. "britpart" för filtrering efter import

      // Validering för att undvika timeouts vid stora Britpart-imports
      if (isNaN(page) || page < 1 || isNaN(per_page) || per_page < 1 || per_page > 100) {
        return { status: 400, jsonBody: { error: "Invalid page or per_page (1-100)" } };
      }

      const qs = new URLSearchParams({ per_page: per_page.toString(), page: page.toString(), order, orderby });
      if (status && status !== "any") qs.set("status", status);
      if (search) qs.set("search", search);
      if (category) qs.set("category", category);
      if (source) qs.set("meta_key", "source"); // Meta-filter för Britpart-produkter
      if (source) qs.set("meta_value", source);

      const res = await wcRequest(`/products?${qs.toString()}`);
      if (!res.ok) throw new Error(`WooCommerce error: ${res.status} - ${await res.text()}`);

      const items = await res.json();
      const total = Number(res.headers.get("x-wp-total") || items.length);
      const pages = Number(res.headers.get("x-wp-totalpages") || 1);

      // Lägg till CORS-headers för att fixa dashboard-fel (frontend-fetch från hub-domänen)
      return { 
        jsonBody: { items, total, pages, page },
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      };
    } catch (e: any) {
      ctx.error(e);
      return { 
        status: 500, 
        jsonBody: { error: e.message || "Error fetching products from WooCommerce" },
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      };
    }
  },
});