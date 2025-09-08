import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetPartCodesForCategories, britpartGetBasicForSkus } from "../shared/britpart";
import { wcBatchCreateProducts, wcBatchUpdateProducts, wcFindProductIdBySku, WooCreate, WooUpdate } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function msg(e: any) { return e?.message || String(e); }

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    let where = "start";
    try {
      const { ids } = (await req.json()) as { ids: number[] };
      if (!Array.isArray(ids) || !ids.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No ids" } };
      }

      // A) Lista SKU
      where = "collect-skus";
      const partCodes = await britpartGetPartCodesForCategories(ids);
      const skus = Array.from(new Set(partCodes.map(String)));
      ctx.log?.(`collect-skus: ${skus.length}`);

      // B) Hämta titel/bild
      where = "fetch-basics";
      const basics = await britpartGetBasicForSkus(skus);
      const haveImages = Object.values(basics).filter(b => b.imageUrl).length;
      ctx.log?.(`fetch-basics: basics=${Object.keys(basics).length}, withImages=${haveImages}`);

      // C) Kolla vilka som redan finns i Woo
      where = "lookup-existing";
      const existing = new Map<string, number>();
      {
        let i = 0; const conc = 8;
        async function worker() {
          while (i < skus.length) {
            const idx = i++;
            const sku = skus[idx];
            try {
              const id = await wcFindProductIdBySku(sku);
              if (id) existing.set(sku, id);
            } catch (e) {
              ctx.warn?.(`lookup fail ${sku}: ${msg(e)}`);
            }
          }
        }
        await Promise.all(Array.from({ length: conc }, worker));
      }
      ctx.log?.(`lookup-existing: exists=${existing.size}`);

      // D) Skapa saknade
      where = "create";
      const toCreate = skus.filter(s => !existing.has(s));
      const createPayloads: WooCreate[] = toCreate.map(sku => {
        const b = basics[sku] || {};
        return {
          name: b.title || sku,
          sku,
          type: "simple",
          status: "draft",
          images: b.imageUrl ? [{ src: b.imageUrl }] : undefined,
        };
      });
      const { count: created, idsBySku } = await wcBatchCreateProducts(createPayloads);
      ctx.log?.(`create: requested=${toCreate.length}, created=${created}`);

      // E) Uppdatera namn/bild på alla (befintliga + nyskapade) om vi har något nytt
      where = "update";
      const updates: WooUpdate[] = [];
      for (const sku of skus) {
        const id = existing.get(sku) ?? idsBySku[sku];
        if (!id) continue;
        const b = basics[sku];
        if (!b) continue;

        const u: WooUpdate = { id };
        if (b.title) u.name = b.title;
        if (b.imageUrl) u.images = [{ src: b.imageUrl }];
        if (u.name || u.images) updates.push(u);
      }
      const updated = await wcBatchUpdateProducts(updates);
      ctx.log?.(`update: candidates=${updates.length}, updated=${updated}`);

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          where: "done",
          selectedCategoryIds: ids,
          totalSkus: skus.length,
          exists: existing.size,
          created,
          updatedWithImagesOrName: updated,
          samples: skus.slice(0, 10),
        },
      };
    } catch (e: any) {
      ctx.error?.(e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: msg(e) } };
    }
  },
});
