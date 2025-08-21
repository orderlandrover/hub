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
      const body = (await req.json()) as { subcategoryIds: string[]; categoryId?: number; pagesize?: number };
      const { subcategoryIds = [], categoryId, pagesize = 50 } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      let created = 0;
      let updated = 0;
      const errors: Array<{ sku: string; error: string }> = [];

      for (const sid of subcategoryIds) {
        const res = await britpartGetAll({ subcategory: sid, pagesize });
        const data = await res.json();
        const items: any[] =
          Array.isArray(data) ? data :
          Array.isArray(data?.items) ? data.items :
          Array.isArray(data?.data) ? data.data :
          [];

        for (const row of items) {
          const sku = readPartNumber(row);
          if (!sku) continue;
          const name = readDescription(row) || sku;

          try {
            // Finns den redan?
            const r = await wcRequest(`/products?sku=${encodeURIComponent(sku)}`);
            const arr = await r.json();
            const existing = Array.isArray(arr) ? arr[0] : null;

            const payload: any = {
              sku,
              name,
              // Vi sätter inte pris här – det kommer från månadspriset via price-upload
              manage_stock: false,
              ...(categoryId ? { categories: [{ id: categoryId }] } : {}),
            };

            if (!existing) {
              await wcRequest(`/products`, { method: "POST", body: JSON.stringify(payload) });
              created++;
            } else {
              await wcRequest(`/products/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
              updated++;
            }
          } catch (err: any) {
            errors.push({ sku, error: err?.message || String(err) });
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