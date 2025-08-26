// api/wc-categories1/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch, readJsonSafe } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

app.http("wc-categories1", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "wc-categories1",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      // Hämta alla kategorier (paginera vid behov)
      let page = 1;
      const perPage = 100;
      const out: any[] = [];

      // loopa tills slut (Woo returnerar tom array när slut)
      // eller använd headers "x-wp-totalpages" – vi kör enkelt & robust
      for (;;) {
        const res = await wcFetch(`/wp-json/wc/v3/products/categories?per_page=${perPage}&page=${page}`);
        const data = await readJsonSafe<any[]>(res);
        if (!Array.isArray(data) || data.length === 0) break;
        out.push(...data);
        if (data.length < perPage) break;
        page++;
      }

      // Minimera svaret till vad fronten brukar använda
      const categories = out.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        parent: c.parent,
        count: c.count,
      }));

      return { status: 200, headers: CORS, jsonBody: { ok: true, total: categories.length, categories } };
    } catch (e: any) {
      ctx.error("wc-categories1 error", e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message ?? e) } };
    }
  },
});