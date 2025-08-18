import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("wc-categories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      const items: any[] = [];
      let page = 1;
      while (true) {
        const res = await wcRequest(`/products/categories?per_page=100&page=${page}`);
        const part = await res.json();
        items.push(...part);
        const pages = Number(res.headers.get("x-wp-totalpages") || "1");
        if (page >= pages) break;
        page++;
      }

      // sortera efter namn för trevligare UI
      items.sort((a, b) => a.name.localeCompare(b.name, "sv"));

      return { jsonBody: { items } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
