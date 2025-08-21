import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetAll, readPartNumber } from "../shared/britpart";
import { wcRequest } from "../shared/wc";

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[]; limit?: number };
      const { subcategoryIds = [], limit = 3 } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      let create = 0, update = 0, skip = 0;
      const perSub: Array<{ subcategory: string; count: number }> = [];

      for (const sid of subcategoryIds) {
        const res = await britpartGetAll({ subcategory: sid, pagesize: Math.max(10, limit * 2) });
        const data = await res.json();
        const items: any[] = data?.items || data?.data || data || [];
        const slice = items.slice(0, limit); // bara de första N för test

        let cnt = 0;
        for (const row of slice) {
          const sku = readPartNumber(row);
          if (!sku) continue;
          cnt++;

          // Finns i WC?
          const wc = await wcRequest(`/products?sku=${encodeURIComponent(sku)}`);
          const arr = await wc.json();
          if (Array.isArray(arr) && arr.length > 0) update++;
          else create++;
        }
        perSub.push({ subcategory: sid, count: cnt });
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