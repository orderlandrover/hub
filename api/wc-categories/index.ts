import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("wcCategories", {                     // internt namn (camelCase)
  route: "wc-categories",                     // OFFENTLIG URL  -> /api/wc-categories
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      const url = new URL(req.url);
      const search = url.searchParams.get("search") ?? "";
      const perPage = url.searchParams.get("per_page") ?? "100";
      const page = url.searchParams.get("page") ?? "1";

      const qs = new URLSearchParams({ per_page: perPage, page, hide_empty: "false" });
      if (search) qs.set("search", search);

      const res = await wcRequest(`/products/categories?${qs.toString()}`);
      const items = await res.json();
      const total = Number(res.headers.get("x-wp-total") || items.length);
      const pages = Number(res.headers.get("x-wp-totalpages") || 1);

      return { jsonBody: { items, total, pages } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});