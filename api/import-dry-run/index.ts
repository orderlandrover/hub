import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpart } from "../shared/britpart";

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: Array<string | number> };
      const ids = (body?.subcategoryIds || []).map(String).filter(Boolean);

      if (ids.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      let parts: any[] = [];
      for (const id of ids) {
        // enligt Britpart: /part/getall?subcategory=<id>&token=<KEY>
        const r = await britpart("/part/getall", {}, { subcategory: id });
        const txt = await r.text();

        // robust parse: vissa svar kan vara tomma, html osv
        let data: any = null;
        try { data = JSON.parse(txt); } catch { /* låt data vara null */ }

        const items = Array.isArray(data)
          ? data
          : (data?.parts || data?.items || data?.data || []);

        if (Array.isArray(items)) {
          parts = parts.concat(items);
        }
      }

      // returnera bara en sammanfattning så länge
      return {
        jsonBody: {
          ok: true,
          summary: { subcategories: ids, count: parts.length },
          sample: (parts || []).slice(0, 10)  // visa de 10 första för kontroll
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});