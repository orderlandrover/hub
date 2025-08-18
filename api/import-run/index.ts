import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpart } from "../shared/britpart";
import { wcRequest } from "../shared/wc";
import { toWCProduct } from "../shared/map";

app.http("import-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = await req.json() as { subcategoryIds: string[], categoryMap?: Record<string, number> };
      const { subcategoryIds = [], categoryMap = {} } = body || {};
      if (!subcategoryIds.length) return { status: 400, jsonBody: { error: "subcategoryIds required" } };

      const created: any[] = [], updated: any[] = [], skipped: any[] = [];

      for (const subId of subcategoryIds) {
        // OBS: byt endpoint mot Britparts riktiga (exempel)
        const r = await britpart(`/products?subcategory=${encodeURIComponent(subId)}&page=1&size=200`);
        const { items = [] } = await r.json();

        for (const bp of items) {
          const payload = toWCProduct(bp, categoryMap);
          if (!payload.sku) { skipped.push({ reason: "no-sku", bp }); continue; }

          // Finns SKU i WC?
          const check = await wcRequest(`/products?sku=${encodeURIComponent(payload.sku)}`);
          const existing = await check.json();
          if (Array.isArray(existing) && existing.length > 0) {
            const id = existing[0].id;
            const res = await wcRequest(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
            updated.push(await res.json());
          } else {
            const res = await wcRequest(`/products`, { method: "POST", body: JSON.stringify(payload) });
            created.push(await res.json());
          }
        }
      }

      return { jsonBody: { ok: true, created: created.length, updated: updated.length, skipped: skipped.length } };
    } catch (e:any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
