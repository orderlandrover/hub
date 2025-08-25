// api/import-dry-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetPartCodesForCategories } from "../shared/britpart";
import { wcFindProductBySku } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      const body = (await req.json().catch(() => ({}))) as {
        subcategoryIds?: (string | number)[];
        categoryIds?: (string | number)[];
      };

      // vi accepterar båda fälten, tar första som finns
      const idsRaw = body.subcategoryIds ?? body.categoryIds;
      if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
        return { status: 400, jsonBody: { error: "categoryIds required" }, headers: CORS };
      }

      const catIds = idsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
      const partCodes = await britpartGetPartCodesForCategories(catIds);

      // kolla vad som redan finns i Woo (en lätt check via sku)
      let create = 0, update = 0, skip = 0;
      const sample: Array<{ action: "create" | "update" | "skip"; sku: string; id?: number }> = [];

      for (const sku of partCodes.slice(0, 50)) { // sample för UI (full körning görs i import-run)
        const hit = await wcFindProductBySku(sku);
        if (hit?.id) {
          update++;
          sample.push({ action: "update", sku, id: hit.id });
        } else {
          create++;
          sample.push({ action: "create", sku });
        }
      }

      // resten räknas som “okända”, vi antar create/skip beroende på strategi
      const known = create + update;
      if (partCodes.length > known) {
        // vi antar create på resten (det är just en DRY-run)
        create += partCodes.length - known;
      }

      return {
        status: 200,
        jsonBody: {
          ok: true,
          total: partCodes.length,
          summary: { create, update, skip },
          sample,
        },
        headers: CORS,
      };
    } catch (e: any) {
      return {
        status: 500,
        jsonBody: { error: e?.message || "Backend call failure" },
        headers: CORS,
      };
    }
  },
});