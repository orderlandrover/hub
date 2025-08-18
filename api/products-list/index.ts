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

      const page = url.searchParams.get("page") || "1";
      const status = url.searchParams.get("status") || ""; // tom = alla
      const search = url.searchParams.get("search") || "";
      const category = url.searchParams.get("category") || "";
      const orderby = url.searchParams.get("orderby") || "title";
      const order = url.searchParams.get("order") || "asc";
      const per_page = url.searchParams.get("per_page") || "100";

      const qs = new URLSearchParams({ per_page, page, order, orderby });
      if (status && status !== "any") qs.set("status", status);
      if (search) qs.set("search", search);
      if (category) qs.set("category", category);

      const res = await wcRequest(`/products?${qs.toString()}`);
      const items = await res.json();
      const total = Number(res.headers.get("x-wp-total") || items.length);
      const pages = Number(res.headers.get("x-wp-totalpages") || 1);

      return { jsonBody: { items, total, pages, page: Number(page) } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
