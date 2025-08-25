import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { collectPartCodesFromMany } from "../shared/britpart";
import { wcFindProductBySku } from "../shared/wc";

type Body = {
  categoryIds: number[];      // valda underkategorier, ex [44,57]
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// enkel concurrency‑begränsare för Woo-anrop
async function mapLimit<T, R>(arr: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length);
  let i = 0;
  const workers: Promise<void>[] = new Array(Math.min(limit, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= arr.length) break;
      out[idx] = await fn(arr[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-dry-run" }, headers: CORS };

    try {
      const body = (await req.json()) as Body;
      const ids = Array.isArray(body?.categoryIds) ? body.categoryIds : [];
      if (!ids.length) return { status: 400, jsonBody: { error: "categoryIds required" }, headers: CORS };

      // 1) Hämta SKU:er från Britpart
      const skus = await collectPartCodesFromMany(ids);

      // 2) Kolla mot WooCommerce
      let create = 0, update = 0;
      const creates: string[] = [];
      const updates: string[] = [];

      await mapLimit(skus, 6, async (sku) => {
        const prod = await wcFindProductBySku(sku);
        if (!prod) {
          create++;
          if (creates.length < 10) creates.push(sku);
        } else {
          update++;
          if (updates.length < 10) updates.push(sku);
        }
      });

      return {
        status: 200,
        jsonBody: {
          ok: true,
          categories: ids,
          skuCount: skus.length,
          create,
          update,
          sample: { creates, updates }
        },
        headers: CORS
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || String(e) }, headers: CORS };
    }
  }
});