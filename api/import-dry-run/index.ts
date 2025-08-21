import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetAll, readPartNumber, readDescription } from "../shared/britpart";
import { wcRequest } from "../shared/wc";

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[]; pagesize?: number };
      const { subcategoryIds = [], pagesize = 50 } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      const create: any[] = [];
      const update: any[] = [];
      const skip: any[] = [];
      const perSub: Array<{ subcategory: string; count: number }> = [];

      for (const sid of subcategoryIds) {
        // hämta första sidan – utöka med loop om du vill
        const res = await britpartGetAll({ subcategory: sid, pagesize });
        const data = await res.json();
        const items: any[] =
          Array.isArray(data) ? data :
          Array.isArray(data?.items) ? data.items :
          Array.isArray(data?.data) ? data.data :
          [];

        perSub.push({ subcategory: sid, count: items.length });

        // jämför med WC på SKU
        for (const row of items) {
          const sku = readPartNumber(row);
          const name = readDescription(row) || sku;
          if (!sku) continue;

          let existing: any = null;
          try {
            const r = await wcRequest(`/products?sku=${encodeURIComponent(sku)}`);
            const arr = await r.json();
            existing = Array.isArray(arr) ? arr[0] : null;
          } catch {
            // Om WC-fel – räkna hellre som "create"-kandidat än att stoppa allt
          }

          if (!existing) {
            create.push({ sku, name, source: "britpart", subcategory: sid });
          } else {
            // här kan du göra en diff av fält om du vill – nu markerar vi som “skip” (inget att ändra)
            skip.push({ id: existing.id, sku });
          }
        }
      }

      return {
        jsonBody: {
          create,
          update,
          skip,
          summary: { create: create.length, update: update.length, skip: skip.length },
          perSub
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});