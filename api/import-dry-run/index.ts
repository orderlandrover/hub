import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetAllJSON } from "../shared/britpart";

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[] };
      const ids = Array.isArray(body?.subcategoryIds) ? body.subcategoryIds : [];
      if (!ids.length) return { status: 400, jsonBody: { error: "subcategoryIds required" } };

      const perSub: Array<{ subcategory: string; count: number }> = [];
      let total = 0;

      for (const id of ids) {
        // Britpart filtrerar med ?subcategory=<id> direkt på getall
        const data = await britpartGetAllJSON<any>({ subcategory: id });
        const items: any[] = Array.isArray(data) ? data : (data.items || data.data || []);
        perSub.push({ subcategory: id, count: items.length });
        total += items.length;
      }

      return {
        jsonBody: {
          summary: { create: total, update: 0, skip: 0 }, // i dry-run räknar vi bara hittade rader
          perSub,
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});