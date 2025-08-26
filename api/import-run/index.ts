// api/import-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetByCategories, BritpartImportItem } from "../shared/britpart";
import { wcFindProductBySku, wcCreateProduct, wcUpdateProduct } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

type RunBody = {
  categoryIds: number[];
  publish?: boolean;
  defaultStock?: number;
  wooCategoryId?: number;
};

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-run" }, headers: CORS };

    try {
      const body = (await req.json()) as RunBody;
      if (!body?.categoryIds?.length) throw new Error("categoryIds required");

      const publish = !!body.publish;
      const defaultStock = Number(body.defaultStock ?? 100);
      const wooCategoryId = body.wooCategoryId ? Number(body.wooCategoryId) : undefined;

      const items: BritpartImportItem[] = await britpartGetByCategories(body.categoryIds);

      let created = 0, updated = 0, skipped = 0;
      const errors: any[] = [];
      const sample: any[] = [];

      for (const it of items) {
        const sku = it.sku?.trim();
        if (!sku) { skipped++; continue; }

        try {
          const existing = await wcFindProductBySku(sku);

          const basePayload: any = {
            name: it.name || sku,
            sku,
            description: it.description ?? "",
            manage_stock: true,
            stock_status: "instock",
            stock_quantity: defaultStock,
          };
          if (wooCategoryId) basePayload.categories = [{ id: wooCategoryId }];
          if (publish) basePayload.status = "publish";

          if (!existing) {
            const res = await wcCreateProduct(basePayload);
            if (!res.ok) {
              const txt = await res.text();
              errors.push({ sku, error: txt.slice(0, 300) });
              continue;
            }
            created++;
            if (sample.length < 5) sample.push({ action: "created", sku });
          } else {
            const res = await wcUpdateProduct(existing.id, basePayload);
            if (!res.ok) {
              const txt = await res.text();
              errors.push({ sku, id: existing.id, error: txt.slice(0, 300) });
              continue;
            }
            updated++;
            if (sample.length < 5) sample.push({ action: "updated", sku, id: existing.id });
          }
        } catch (err: any) {
          errors.push({ sku: it.sku, error: err?.message || String(err) });
        }
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: { ok: true, total: items.length, created, updated, skipped, errors, sample },
      };
    } catch (e: any) {
      return { status: 400, headers: CORS, jsonBody: { ok: false, error: e.message } };
    }
  },
});