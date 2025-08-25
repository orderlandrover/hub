// api/import-dry-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetPartCodesForCategories } from "../shared/britpart";
import { wcFindProductBySku } from "../shared/wc";

type Body = { categoryIds?: number[] };

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const CORS = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-dry-run" }, headers: CORS };

    try {
      const body = (await req.json().catch(() => ({}))) as Body;
      const ids = Array.isArray(body.categoryIds) ? body.categoryIds.map(Number).filter(Number.isFinite) : null;
      if (!ids || ids.length === 0) {
        return { status: 400, jsonBody: { error: "categoryIds required" }, headers: CORS };
      }

      // 1) Hämta ALLA partCodes rekursivt för de valda kategorierna
      const partCodes = await britpartGetPartCodesForCategories(ids);

      // 2) “Simulera” vad som skulle hända i WooCommerce
      let create = 0, update = 0, skip = 0;
      const sample: Array<{ action: "create" | "update" | "skip"; sku: string; id?: number }> = [];

      for (const sku of partCodes) {
        // Hitta produkt i Woo med denna SKU
        const product = await wcFindProductBySku(sku);
        if (product) {
          update++;
          if (sample.length < 5) sample.push({ action: "update", sku, id: product.id });
        } else {
          create++;
          if (sample.length < 5) sample.push({ action: "create", sku });
        }
      }

      return {
        status: 200,
        jsonBody: {
          ok: true,
          total: partCodes.length,
          create,
          update,
          skip,
          sample,
        },
        headers: CORS,
      };
    } catch (e: any) {
      ctx.error("import-dry-run failed", e);
      return { status: 500, jsonBody: { error: e?.message || String(e) }, headers: CORS };
    }
  },
});