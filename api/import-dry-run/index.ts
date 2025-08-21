import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetAll } from "../shared/britpart";

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[]; limitPerSub?: number };
      const { subcategoryIds = [], limitPerSub = 3 } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      let create = 0, update = 0, skip = 0;
      const perSub: Array<{ subcategory: string; count: number }> = [];

      for (const sub of subcategoryIds) {
        // Hämta bara några få för snabb dry-run (top/limit funkar bra om API’t stödjer)
        const r = await britpartGetAll({ subcategory: sub, top: limitPerSub });
        const j = await r.json();
        const items = Array.isArray(j) ? j : (j.items || j.data || []);
        perSub.push({ subcategory: String(sub), count: items.length });
        create += items.length;                 // tills vi gör riktig diff mot WC
      }

      return {
        jsonBody: {
          summary: { create, update, skip },
          perSub,
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});