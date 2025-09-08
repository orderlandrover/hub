import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetPartCodesForCategories } from "../shared/britpart";
import {
  wcFindProductIdBySku,
  wcBatchCreateProducts,
  WooCreate,
} from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

async function mapExistingSkus(skus: string[], ctx: InvocationContext) {
  const out = new Map<string, number>();
  // begränsa samtidig I/O
  const concurrency = 10;
  let i = 0;
  async function worker() {
    while (i < skus.length) {
      const idx = i++;
      const sku = skus[idx];
      try {
        const id = await wcFindProductIdBySku(sku);
        if (id) out.set(sku, id);
      } catch (e) {
        ctx.warn?.(`Lookup misslyckades för SKU ${sku}: ${String((e as any)?.message || e)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out; // sku -> productId
}

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const { ids } = (await req.json()) as { ids: number[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No ids" } };
      }

      // 1) Hitta alla partCodes (artiklar) under valda kategorier
      const partCodes = await britpartGetPartCodesForCategories(ids);
      const uniqueSkus = Array.from(new Set(partCodes.map(String)));

      // 2) Vilka finns redan i Woo?
      const existingMap = await mapExistingSkus(uniqueSkus, ctx);
      const existing = Array.from(existingMap.keys());
      const toCreateSkus = uniqueSkus.filter((s) => !existingMap.has(s));

      // 3) Skapa det som saknas (draft, endast SKU/namn – pris & beskrivning kan fyllas i senare)
      const createPayloads: WooCreate[] = toCreateSkus.map((sku) => ({
        name: sku,
        sku,
        type: "simple",
        status: "draft",
      }));
      const { count: createdCount } = await wcBatchCreateProducts(createPayloads);

      // 4) Svara med tydlig statistik
      const body = {
        ok: true,
        selectedCategoryIds: ids,
        totalSkus: uniqueSkus.length,
        exists: existing.length,
        created: createdCount,
        // ett litet smakprov för felsökning
        sampleSkus: uniqueSkus.slice(0, 10),
      };

      ctx.log?.(`Import-run: totals=${body.totalSkus}, exists=${body.exists}, created=${body.created}`);
      return { status: 200, headers: CORS, jsonBody: body };
    } catch (e: any) {
      ctx.error?.(e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message || e) } };
    }
  },
});
