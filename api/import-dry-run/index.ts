import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpart } from "../shared/britpart";
import { getProductBySku } from "../shared/wc";
import { BritpartProduct, toWCProduct } from "../shared/map";

async function fetchBritpartForSubcat(subId: string): Promise<BritpartProduct[]> {
  // Prova några vanliga varianter – anpassa efter ert riktiga API
  try {
    // 1) Om din BRITPART_API_BASE redan är ett /getall-endpoint:
    const r = await britpart(`?subcategory=${encodeURIComponent(subId)}`);
    const j = await r.json();
    return (j.items || j.data || j) as BritpartProduct[];
  } catch {
    // 2) Om BRITPART_API_BASE är en "base", försök /parts/by-subcategory
    const r2 = await britpart(`/parts?subcategory=${encodeURIComponent(subId)}`);
    const j2 = await r2.json();
    return (j2.items || j2.data || j2) as BritpartProduct[];
  }
}

app.http("import-dry-run", {
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

      const create: any[] = [];
      const update: any[] = [];
      const skip: any[] = [];

      for (const sid of subcategoryIds) {
        const parts = await fetchBritpartForSubcat(sid);
        for (const p of parts) {
          if (!p.partNumber) continue;
          const wc = await getProductBySku(p.partNumber);
          const mapped = toWCProduct(p, categoryId);
          if (!wc) {
            create.push({ sku: p.partNumber, preview: mapped });
          } else {
            // Minimal diff: om pris/namn/stock skiljer, flagga update, annars skip
            const diffs: string[] = [];
            if (mapped.regular_price && wc.regular_price !== mapped.regular_price) diffs.push("price");
            if (mapped.name && wc.name !== mapped.name) diffs.push("name");
            if (typeof mapped.stock_quantity === "number" && wc.stock_quantity !== mapped.stock_quantity) diffs.push("stock");
            if (diffs.length) update.push({ id: wc.id, sku: wc.sku, diffs, preview: mapped });
            else skip.push({ id: wc.id, sku: wc.sku });
          }
        }
      }

      return {
        jsonBody: {
          createCount: create.length,
          updateCount: update.length,
          skipCount: skip.length,
          create,
          update,
          skip,
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
