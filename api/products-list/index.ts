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
      const status = url.searchParams.get("status") || "any";
      const search = url.searchParams.get("search") || "";
      const category = url.searchParams.get("category") || "";
      const all = url.searchParams.get("all") === "true";
      const pageParam = Number(url.searchParams.get("page") || "1");
      const per_page = 100;

      const baseQS = new URLSearchParams({ per_page: String(per_page), status });
      if (search) baseQS.set("search", search);
      if (category) baseQS.set("category", category);

      if (!all) {
        baseQS.set("page", String(pageParam));
        const res = await wcRequest(`/products?${baseQS.toString()}`);
        const items = await res.json();
        const total = Number(res.headers.get("x-wp-total") || items.length);
        const pages = Number(res.headers.get("x-wp-totalpages") || 1);
        return { jsonBody: { items, total, pages, page: pageParam } };
      }

      // Hämta alla sidor (skydda med maxPages)
      const firstQS = new URLSearchParams(baseQS);
      firstQS.set("page", "1");
      const firstRes = await wcRequest(`/products?${firstQS.toString()}`);
      const firstItems = await firstRes.json();
      const total = Number(firstRes.headers.get("x-wp-total") || firstItems.length);
      const pages = Number(firstRes.headers.get("x-wp-totalpages") || 1);

      const maxPages = Math.min(pages, 10); // ändra om du vill
      const allItems: any[] = [...firstItems];

      for (let p = 2; p <= maxPages; p++) {
        const qs = new URLSearchParams(baseQS);
        qs.set("page", String(p));
        const r = await wcRequest(`/products?${qs.toString()}`);
        const arr = await r.json();
        allItems.push(...arr);
      }

      return { jsonBody: { items: allItems, total, pages, fetchedPages: maxPages } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
