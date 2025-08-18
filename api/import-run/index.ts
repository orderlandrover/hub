import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpart } from "../shared/britpart";
import { getProductBySku, wcRequest } from "../shared/wc";
import { BritpartProduct, toWCProduct } from "../shared/map";

async function fetchBritpartForSubcat(subId: string): Promise<BritpartProduct[]> {
  try {
    const r = await britpart(`?subcategory=${encodeURIComponent(subId)}`);
    const j = await r.json();
    return (j.items || j.data || j) as BritpartProduct[];
  } catch {
    const r2 = await britpart(`/parts?subcategory=${encodeURIComponent(subId)}`);
    const j2 = await r2.json();
    return (j2.items || j2.data || j2) as BritpartProduct[];
  }
}

app.http("import-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[]; categoryId?: number };
      const { subcategoryIds = [], categoryId } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      let created = 0;
      let updated = 0;
      const errors: { sku: string; error: string }[] = [];

      for (const sid of subcategoryIds) {
        const parts = await fetchBritpartForSubcat(sid);

        // Batcha lite snällt
        for (const p of parts) {
          if (!p.partNumber) continue;
          try {
            const mapped = toWCProduct(p, categoryId);
            const existing = await getProductBySku(p.partNumber);
            if (!existing) {
              await wcRequest(`/products`, {
                method: "POST",
                body: JSON.stringify(mapped),
              });
              created++;
            } else {
              await wcRequest(`/products/${existing.id}`, {
                method: "PUT",
                body: JSON.stringify(mapped),
              });
              updated++;
            }
          } catch (err: any) {
            errors.push({ sku: p.partNumber, error: String(err?.message || err) });
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
