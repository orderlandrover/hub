import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { collectPartCodesFromMany } from "../shared/britpart";
import { wcFindProductBySku, wcFetch } from "../shared/wc";

type Body = {
  categoryIds: number[];
  publish?: boolean;
  defaultPriceSEK?: number;
  manageStock?: boolean;
  stockQty?: number;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

app.http("import-run", {
  route: "import-run",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-run" }, headers: CORS };

    try {
      const body = (await req.json()) as Body;
      const ids = Array.isArray(body?.categoryIds) ? body.categoryIds : [];
      if (!ids.length) return { status: 400, jsonBody: { error: "categoryIds required" }, headers: CORS };

      const publish = !!body.publish;
      const fallbackPrice = Number(body.defaultPriceSEK ?? 0);
      const manageStock = !!body.manageStock;
      const stockQty = Number.isFinite(body.stockQty) ? Number(body.stockQty) : 0;

      const skus = await collectPartCodesFromMany(ids);

      let created = 0, updated = 0, failed = 0;
      const examples = { created: [] as string[], updated: [] as string[], errors: [] as any[] };

      await mapLimit(skus, 4, async (sku) => {
        try {
          const existing = await wcFindProductBySku(sku);

          if (!existing) {
            const payload: any = {
              name: sku,
              sku,
              status: publish ? "publish" : "draft",
              stock_status: manageStock ? (stockQty > 0 ? "instock" : "outofstock") : "instock",
            };
            if (fallbackPrice > 0) payload.regular_price = fallbackPrice.toFixed(2);
            if (manageStock) {
              payload.manage_stock = true;
              payload.stock_quantity = stockQty;
            }

            const res = await wcFetch(`/products`, { method: "POST", body: JSON.stringify(payload) });
            if (!res.ok) {
              failed++; if (examples.errors.length < 5) examples.errors.push({ sku, error: (await res.text()).slice(0, 200) });
              return;
            }
            created++; if (examples.created.length < 5) examples.created.push(sku);
          } else {
            const patch: any = {};
            if (publish && existing.status !== "publish") patch.status = "publish";
            if (fallbackPrice > 0) patch.regular_price = fallbackPrice.toFixed(2);
            if (manageStock) {
              patch.manage_stock = true;
              patch.stock_quantity = stockQty;
              patch.stock_status = stockQty > 0 ? "instock" : "outofstock";
            }

            if (Object.keys(patch).length) {
              const res2 = await wcFetch(`/products/${existing.id}`, { method: "PUT", body: JSON.stringify(patch) });
              if (!res2.ok) {
                failed++; if (examples.errors.length < 5) examples.errors.push({ sku, error: (await res2.text()).slice(0, 200) });
                return;
              }
              updated++; if (examples.updated.length < 5) examples.updated.push(sku);
            }
          }
        } catch (e: any) {
          failed++; if (examples.errors.length < 5) examples.errors.push({ sku, error: e.message || String(e) });
        }
      });

      return {
        status: 200,
        jsonBody: { ok: true, categories: ids, skuCount: skus.length, created, updated, failed, examples },
        headers: CORS
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || String(e) }, headers: CORS };
    }
  }
});