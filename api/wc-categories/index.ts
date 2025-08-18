import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("wc-categories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      const url = new URL(req.url);
      const search = url.searchParams.get("search") || "";
      const perPage = 100;
      let page = 1;

      const items: Array<{ id: number; name: string; slug: string; parent: number; count: number }> = [];

      while (true) {
        const qs = new URLSearchParams({ per_page: String(perPage), page: String(page), hide_empty: "false" });
        if (search) qs.set("search", search);

        const res = await wcRequest(`/products/categories?${qs.toString()}`);
        const chunk = await res.json();
        if (!Array.isArray(chunk) || chunk.length === 0) break;

        for (const c of chunk) {
          items.push({ id: c.id, name: c.name, slug: c.slug, parent: c.parent, count: c.count });
        }

        const totalPages = Number(res.headers.get("x-wp-totalpages") || "1");
        if (page >= totalPages) break;
        page++;
      }

      return { jsonBody: { items } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
