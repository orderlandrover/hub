// api/wc-categories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch, readJsonSafe } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

app.http("wc-categories", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "wc-categories",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      let page = 1;
      const perPage = 100;
      const out: any[] = [];

      // Hämta alla sidor (inkl. tomma kategorier)
      for (;;) {
        const url = `/wp-json/wc/v3/products/categories?per_page=${perPage}&page=${page}&hide_empty=false`;
        const res = await wcFetch(url);
        const data = await readJsonSafe<any[]>(res);

        if (!Array.isArray(data) || data.length === 0) break;
        out.push(...data);
        if (data.length < perPage) break;
        page++;
      }

      const items = out.map((c) => ({
        id: c.id,
        name: c.name,
        parent: c.parent ?? 0,
      }));

      return { status: 200, headers: CORS, jsonBody: { items } };
    } catch (e: any) {
      ctx.error("wc-categories error", e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message ?? e) } };
    }
  },
});