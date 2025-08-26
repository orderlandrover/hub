// api/import-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetByCategories, BritpartImportItem } from "../shared/britpart";
import { wcFindProductBySku, wcCreateProduct, wcUpdateProduct } from "../shared/wc";

type Body = {
  categoryIds: number[];   // Britpart underkategorier du valt
  publish?: boolean;       // publicera direkt (annars draft)
  defaultStock?: number;   // t.ex. 100
  wooCategoryId?: number;  // sätt EN Woo-kategori på alla importerade (valfritt)
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    if (req.method === "GET")     return { status: 200, headers: CORS, jsonBody: { ok: true, name: "import-run" } };

    try {
      const body = (await req.json()) as Body;

      const categoryIds = (body?.categoryIds ?? [])
        .map(Number)
        .filter((n) => Number.isFinite(n));

      if (categoryIds.length === 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "categoryIds (number[]) krävs" } };
      }

      const publish = !!body.publish;
      const defaultStock = Number(body.defaultStock ?? 100);
      const wooCategoryId = body.wooCategoryId ? Number(body.wooCategoryId) : undefined;

      // Hämta produkter från Britpart för dessa kategorier
      const items: BritpartImportItem[] = await britpartGetByCategories(categoryIds);

      let created = 0, updated = 0, skipped = 0;
      const errors: any[] = [];
      const sample: any[] = [];

      // NOTE: Om du vill rate-limita mot Woo, lägg ev. in en liten delay i loopen.
      for (const it of items) {
        const sku = it.sku?.trim();
        if (!sku) { skipped++; continue; }

        try {
          const existing = await wcFindProductBySku(sku);

          const payload: any = {
            name: it.name || sku,
            sku,
            description: it.description ?? "",
            manage_stock: true,
            stock_status: "instock",
            stock_quantity: defaultStock
          };

          if (wooCategoryId) payload.categories = [{ id: wooCategoryId }];
          if (publish)       payload.status = "publish"; // annars draft (Woo’s default)

          if (!existing) {
            const res = await wcCreateProduct(payload);
            if (!res.ok) {
              const txt = await res.text();
              errors.push({ sku, error: txt.slice(0, 400) });
              continue;
            }
            created++;
            if (sample.length < 5) sample.push({ action: "created", sku });
          } else {
            const res = await wcUpdateProduct(existing.id, payload);
            if (!res.ok) {
              const txt = await res.text();
              errors.push({ sku, id: existing.id, error: txt.slice(0, 400) });
              continue;
            }
            updated++;
            if (sample.length < 5) sample.push({ action: "updated", sku, id: existing.id });
          }
        } catch (err: any) {
          errors.push({ sku, error: err?.message || String(err) });
        }
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          total: items.length,
          created,
          updated,
          skipped,
          errors,
          sample
        }
      };
    } catch (e: any) {
      return { status: 400, headers: CORS, jsonBody: { ok: false, error: e?.message ?? String(e) } };
    }
  }
});