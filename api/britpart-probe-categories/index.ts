// api/britpart-probe-categories/index.ts
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { getCategory } from "../shared/britpart"; // har du redan
import { britpartGetPartCodesForCategories, britpartGetBasicForSkus } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e:any)=> e?.message ? String(e.message) : String(e);

async function collectAllLeafIds(rootIds: number[]) {
  // hämta hela trädet nedåt via getCategory() och plocka ut alla leaf-id:n
  const seen = new Set<number>();
  const leaves = new Set<number>();

  async function walk(id:number) {
    if (seen.has(id)) return;
    seen.add(id);
    const c = await getCategory(id);
    const kids = c.subcategories?.map(s=>Number(s.id)) ?? c.subcategoryIds ?? [];
    if (!kids.length) { leaves.add(id); return; }
    for (const k of kids) await walk(Number(k));
  }

  for (const id of rootIds) await walk(Number(id));
  return Array.from(leaves);
}

app.http("britpart-probe-categories", {
  route: "britpart-probe-categories",
  methods: ["POST","OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    try {
      const { ids } = await req.json() as { ids: number[] };
      if (!Array.isArray(ids) || !ids.length) {
        return { status: 400, headers: CORS, jsonBody: { ok:false, error:"No ids" } };
      }

      // 1) alla SKU (unika) under valda rötter
      const skus = Array.from(new Set(
        (await britpartGetPartCodesForCategories(ids)).map(String)
      ));

      // 2) hämta basdata inkl. categoryIds för varje SKU
      const basics = await britpartGetBasicForSkus(skus); // se till att basics[sku].categoryIds finns

      // 3) ta fram alla leafs under rötterna, och räkna täckning per leaf
      const leafIds = new Set<number>(await collectAllLeafIds(ids));
      const byLeaf: Record<number, {count:number, sample:string[]}> = {};

      for (const sku of skus) {
        const b = basics[sku];
        const cats: number[] = Array.isArray(b?.categoryIds) ? b.categoryIds.map(Number) : [];
        const hits = cats.filter((cid)=> leafIds.has(Number(cid)));
        const first = hits[0];
        if (first != null) {
          const bucket = byLeaf[first] ?? (byLeaf[first] = { count:0, sample:[] });
          bucket.count++;
          if (bucket.sample.length < 5) bucket.sample.push(sku);
        }
      }

      // 4) summering och lite provdata
      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          inputIds: ids,
          uniqueSkuCount: skus.length,
          leaves: Object.entries(byLeaf).map(([leafId, v]) => ({
            leafId: Number(leafId),
            count: v.count,
            sampleSkus: v.sample,
          })),
          sampleAll: skus.slice(0, 15),
        }
      };
    } catch (e:any) {
      return { status: 500, headers: CORS, jsonBody: { ok:false, error: emsg(e) } };
    }
  }
});
