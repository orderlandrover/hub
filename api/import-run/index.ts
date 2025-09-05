import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetByCategories, BritpartImportItem } from "../shared/britpart";
import { wcFindProductBySku, wcCreateProduct, wcUpdateProduct } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type RunBody = {
  categoryIds: number[];
  publish?: boolean;          // publicera direkt
  defaultStock?: number;      // t.ex. 100
  wooCategoryId?: number;     // woo-kategori-id att sätta på alla
};

function pickImageUrls(it: BritpartImportItem): string[] {
  // Försök tolka olika fält som kan förekomma
  const candidates = [
    (it as any).imageUrl,
    (it as any).image_url,
    (it as any).image,
    (it as any).img,
    (it as any).thumbnail,
  ];
  const urls: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c)) {
      for (const x of c) if (typeof x === "string" && x.startsWith("http")) urls.push(x);
    } else if (typeof c === "string" && c.startsWith("http")) {
      urls.push(c);
    }
  }
  return Array.from(new Set(urls));
}

function pickPriceSek(it: BritpartImportItem): number | undefined {
  const cand = [(it as any).priceSek, (it as any).priceSEK, (it as any).price_sek, (it as any).price];
  for (const c of cand) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

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
        const sku = it?.sku?.trim();
        if (!sku) { skipped++; continue; }

        try {
          const existing = await wcFindProductBySku(sku);

          const images = pickImageUrls(it).map((src) => ({ src }));
          const priceSek = pickPriceSek(it);

          const basePayload: any = {
            name: it?.name || sku,
            sku,
            description: (it as any)?.description ?? "",
            manage_stock: true,
            stock_status: "instock",
            stock_quantity: defaultStock,
          };

          if (wooCategoryId) basePayload.categories = [{ id: wooCategoryId }];
          if (images.length) basePayload.images = images;
          if (Number.isFinite(priceSek)) basePayload.regular_price = String(priceSek);
          if (publish) basePayload.status = "publish";

          if (!existing) {
            const res = await wcCreateProduct(basePayload);
            if (!res.ok) {
              const txt = await res.text();
              errors.push({ sku, error: txt.slice(0, 400) });
              continue;
            }
            created++;
            if (sample.length < 5) sample.push({ action: "created", sku });
          } else {
            // Vid update: skicka endast fält vi vill uppdatera (särskilt images/categories/pris)
            const updatePayload: any = {
              name: basePayload.name,
              description: basePayload.description,
              manage_stock: true,
              stock_status: "instock",
              stock_quantity: defaultStock,
            };
            if (wooCategoryId) updatePayload.categories = basePayload.categories;
            if (images.length) updatePayload.images = images;
            if (Number.isFinite(priceSek)) updatePayload.regular_price = basePayload.regular_price;
            if (publish) updatePayload.status = "publish";

            const res = await wcUpdateProduct(existing.id, updatePayload);
            if (!res.ok) {
              const txt = await res.text();
              errors.push({ sku, id: existing.id, error: txt.slice(0, 400) });
              continue;
            }
            updated++;
            if (sample.length < 5) sample.push({ action: "updated", sku, id: existing.id });
          }
        } catch (err: any) {
          errors.push({ sku: it?.sku, error: err?.message || String(err) });
        }
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: { ok: true, total: items.length, created, updated, skipped, errors, sample },
      };
    } catch (e: any) {
      return { status: 400, headers: CORS, jsonBody: { ok: false, error: e?.message || String(e) } };
    }
  },
});