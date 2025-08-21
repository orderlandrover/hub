import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

app.http("products-list", {
  route: "products-list",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const page = url.searchParams.get("page") || "1";
      const perPage = url.searchParams.get("per_page") || "100";
      const orderby = url.searchParams.get("orderby") || "title";
      const order = url.searchParams.get("order") || "asc";
      const status = url.searchParams.get("status") || "";
      const search = url.searchParams.get("search") || "";
      const category = url.searchParams.get("category") || "";

      const qs = new URLSearchParams({
        page, per_page: perPage, orderby, order,
      });
      if (status && status !== "any") qs.set("status", status);
      if (search) qs.set("search", search);
      if (category) qs.set("category", category);

      const res = await wcFetch(`/products?${qs.toString()}`);
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`WC products ${res.status}: ${t}`);
      }
      const items = await res.json();

      const total = Number(res.headers.get("x-wp-total") || items.length || 0);
      const pages = Number(res.headers.get("x-wp-totalpages") || 1);

      return { status: 200, jsonBody: { items, total, pages, page: Number(page) } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "products-list failed" } };
    }
  }
});