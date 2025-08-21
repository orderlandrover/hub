import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetAll, readPartNumber, readDescription } from "../shared/britpart";
import { wcRequest } from "../shared/wc";

app.http("import-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[]; limit?: number; categoryId?: number };
      const { subcategoryIds = [], limit = 3, categoryId } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      let created = 0, updated = 0;
      const errors: Array<{ sku: string; error: string }> = [];

      for (const sid of subcategoryIds) {
        const res = await britpartGetAll({ subcategory: sid, pagesize: Math.max(10, limit * 2) });
        const data = await res.json();
        const items: any[] = data?.items || data?.data || data || [];

        for (const row of items.slice(0, limit)) {
          const sku = readPartNumber(row);
          if (!sku) continue;
          const name = readDescription(row) || sku;

          try {
            const check = await wcRequest(`/products?sku=${encodeURIComponent(sku)}`);
            const arr = await check.json();
            const payload: any = {
              sku,
              name,
              status: "draft",
            };
            if (categoryId) payload.categories = [{ id: categoryId }];

            if (Array.isArray(arr) && arr.length > 0) {
              const id = arr[0].id;
              await wcRequest(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
              updated++;
            } else {
              await wcRequest(`/products`, { method: "POST", body: JSON.stringify(payload) });
              created++;
            }
          } catch (err: any) {
            errors.push({ sku, error: String(err?.message || err) });
          }
        }
      }

      return { jsonBody: { ok: true, created, updated, errors } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});