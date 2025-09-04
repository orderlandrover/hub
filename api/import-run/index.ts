// api/import-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetItemsForCategories, BritpartImportItem } from "../shared/britpart";
import { wcFindProductIdBySku, wcFetch } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type RunBody = {
  categoryIds: number[];
  publish?: boolean;
  defaultStock?: number;
  wooCategoryId?: number;
};

/* ------------------------ Woo wrappers ------------------------ */
// Skicka JSON-kropp via wcFetch (som redan hanterar auth & bas-URL)
async function wcCreateProduct(payload: any): Promise<Response> {
  // Behöver din wcFetch path med eller utan ledande "/"?
  // Om du får 404, ändra till "products" istället för "/products".
  return wcFetch("/products", { method: "POST", body: JSON.stringify(payload) });
}
async function wcUpdateProduct(id: number, payload: any): Promise<Response> {
  return wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

/* ------------------------ Normaliserare för fält ------------------------ */
function pickSku(it: any): string | undefined {
  const cands = [it?.sku, it?.SKU, it?.partNumber, it?.part_number, it?.partNo, it?.part_code, it?.partCode, it?.code];
  for (const c of cands) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return undefined;
}
function pickName(it: any): string | undefined {
  const cands = [it?.name, it?.title, it?.productName, it?.product_name];
  for (const c of cands) if (typeof c === "string" && c.trim()) return c.trim();
  return undefined;
}
function pickDescription(it: any): string {
  const cands = [
    it?.descriptionHtml, it?.longDescription, it?.long_description,
    it?.description, it?.desc, it?.shortDescription, it?.short_description
  ];
  for (const c of cands) if (typeof c === "string" && c.trim()) return c;
  return "";
}
function extractUrls(x: any): string[] {
  const urls: string[] = [];
  const pushIf = (u: any) => { if (typeof u === "string" && /^https?:\/\//i.test(u)) urls.push(u); };
  if (!x) return urls;
  if (typeof x === "string") pushIf(x);
  else if (Array.isArray(x)) {
    for (const y of x) {
      if (typeof y === "string") pushIf(y);
      else if (y && typeof y === "object") { pushIf(y.url); pushIf(y.src); pushIf(y.href); }
    }
  } else if (typeof x === "object") { pushIf(x.url); pushIf(x.src); pushIf(x.href); }
  return urls;
}
function pickImageUrls(it: any): string[] {
  const cands = [
    it.imageUrls, it.image_urls, it.images, it.gallery, it.assets, it.media,
    it.imageUrl, it.image_url, it.image, it.img, it.thumbnail
  ];
  const set = new Set<string>();
  for (const c of cands) for (const u of extractUrls(c)) set.add(u);
  return Array.from(set);
}
function parsePriceToNumber(raw: any): number | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  s = s.replace(/[^\d,.\-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0) return n;
  return undefined;
}
function pickPriceSek(it: any): number | undefined {
  const cands = [it.priceSEK, it.priceSek, it.price_sek, it.price, it.unitPrice, it.unit_price];
  for (const c of cands) {
    const n = parsePriceToNumber(c);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ------------------------------- Endpoint ------------------------------- */
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

      // Hämta fulla produktobjekt från Britpart (inte bara koder)
      const items: BritpartImportItem[] = await britpartGetItemsForCategories(body.categoryIds);

      let created = 0, updated = 0, skipped = 0;
      const errors: any[] = [];
      const sample: any[] = [];

      for (const raw of items) {
        const sku = pickSku(raw);
        if (!sku) { skipped++; continue; }

        try {
          // *** Viktigt: använd wcFindProductIdBySku (detta finns i din wc.ts) ***
          const foundId = await wcFindProductIdBySku(sku).catch(() => null);
          const existingId = foundId != null ? Number(foundId) : null;

          const imagesArr = pickImageUrls(raw).map((src) => ({ src }));
          const priceSek = pickPriceSek(raw);
          const name = pickName(raw) || sku;
          const description = pickDescription(raw);

          const basePayload: any = {
            name,
            sku,
            description,
            manage_stock: true,
            stock_status: "instock",
            stock_quantity: defaultStock,
          };
          if (wooCategoryId) basePayload.categories = [{ id: wooCategoryId }];
          if (imagesArr.length) basePayload.images = imagesArr;
          if (Number.isFinite(priceSek)) basePayload.regular_price = String(priceSek);
          if (publish) basePayload.status = "publish";

          if (!existingId) {
            const res = await wcCreateProduct(basePayload);
            if (!res.ok) {
              const txt = await res.text();
              errors.push({ sku, error: txt.slice(0, 400) });
              continue;
            }
            created++;
            if (sample.length < 5) sample.push({ action: "created", sku, preview: basePayload });
          } else {
            const updatePayload: any = {
              name: basePayload.name,
              description: basePayload.description,
              manage_stock: true,
              stock_status: "instock",
              stock_quantity: defaultStock,
            };
            if (wooCategoryId) updatePayload.categories = basePayload.categories;
            if (imagesArr.length) updatePayload.images = imagesArr;
            if (Number.isFinite(priceSek)) updatePayload.regular_price = basePayload.regular_price;
            if (publish) updatePayload.status = "publish";

            const res = await wcUpdateProduct(existingId, updatePayload);
            if (!res.ok) {
              const txt = await res.text();
              errors.push({ sku, id: existingId, error: txt.slice(0, 400) });
              continue;
            }
            updated++;
            if (sample.length < 5) sample.push({ action: "updated", sku, id: existingId, preview: updatePayload });
          }
        } catch (err: any) {
          errors.push({ sku: raw?.sku, error: err?.message || String(err) });
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
