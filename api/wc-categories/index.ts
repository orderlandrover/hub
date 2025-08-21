import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

app.http("wc-categories", {
  route: "wc-categories",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const perPage = url.searchParams.get("per_page") || "100";
      const page = url.searchParams.get("page") || "1";
      const search = url.searchParams.get("search") || "";

      const qs = new URLSearchParams({ per_page: perPage, page });
      if (search) qs.set("search", search);

      const res = await wcFetch(`/products/categories?${qs.toString()}`);
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`WC categories ${res.status}: ${t}`);
      }
      const items = await res.json();
      const total = Number(res.headers.get("x-wp-total") || items.length || 0);
      const pages = Number(res.headers.get("x-wp-totalpages") || 1);

      return { status: 200, jsonBody: { items, total, pages, page: Number(page) } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "wc-categories failed" } };
    }
  }
});