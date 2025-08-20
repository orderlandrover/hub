import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetAllJSON } from "../shared/britpart";
import { getProductBySku, wcRequest } from "../shared/wc";

type BpItem = {
  partNumber?: string;
  description?: string;
  price?: number | string;
  imageUrls?: string[];
  stockQty?: number;
};

function mapToWC(p: BpItem) {
  return {
    sku: p.partNumber,
    name: p.description || p.partNumber,
    regular_price: p.price != null ? String(p.price) : undefined,
    images: (p.imageUrls || []).map((src) => ({ src })),
    manage_stock: p.stockQty != null,
    stock_quantity: p.stockQty,
  } as any;
}

app.http("import-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[] };
      const ids = Array.isArray(body?.subcategoryIds) ? body.subcategoryIds : [];
      if (!ids.length) return { status: 400, jsonBody: { error: "subcategoryIds required" } };

      let created = 0, updated = 0;
      const errors: Array<{ sku: string; error: string }> = [];

      for (const id of ids) {
        const data = await britpartGetAllJSON<any>({ subcategory: id });
        const items: BpItem[] = Array.isArray(data) ? data : (data.items || data.data || []);

        for (const bp of items) {
          const sku = bp.partNumber?.trim();
          if (!sku) continue;
          try {
            const existing = await getProductBySku(sku);
            const payload = mapToWC(bp);

            if (!existing) {
              await wcRequest(`/products`, { method: "POST", body: JSON.stringify(payload) });
              created++;
            } else {
              await wcRequest(`/products/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
              updated++;
            }
          } catch (err: any) {
            errors.push({ sku, error: String(err?.message || err) });
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