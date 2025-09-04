// api/import-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BritpartImportItem, britpartGetAllBySubcategories } from "../shared/britpart";
import { wcFindProductIdBySku, wcFetch } from "../shared/wc";

/* ------------------------------- CORS ------------------------------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type RunBody = {
  categoryIds: number[];
  publish?: boolean;
  defaultStock?: number;
  wooCategoryId?: number;  // om satt används denna Woo-kategori för alla produkter
  debug?: boolean;         // true = skriv inte till Woo, returnera bara previews
  limit?: number;          // max antal produkter (för test)
};

/* --------------------------- Helpers: svar --------------------------- */
function ok(data: any): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: true, ...data } };
}
function fail(message: string, extra?: any): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: false, error: message, ...extra } };
}

/* ------------------------ Woo wrappers (path-fallback) ------------------------ */
async function wcCreateProduct(payload: any): Promise<Response> {
  let res = await wcFetch("/products", { method: "POST", body: JSON.stringify(payload) });
  if (res.status === 404) res = await wcFetch("products", { method: "POST", body: JSON.stringify(payload) });
  return res;
}
async function wcUpdateProduct(id: number, payload: any): Promise<Response> {
  let res = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  if (res.status === 404) res = await wcFetch(`products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  return res;
}

/* ------------------------ Fält-plockare / normalisering ------------------------ */
const pickSku = (it: any): string | undefined =>
  typeof it?.sku === "string" && it.sku.trim() ? it.sku.trim() : undefined;

/** Hämta bild-URL:er som strängar från BritpartImportItem */
const urlsFromItem = (it: BritpartImportItem): string[] => {
  const arr: unknown[] = Array.isArray((it as any).imageUrls)
    ? (it as any).imageUrls
    : (it.images?.map((x: any) => x?.url || x?.src || x?.href) || []);
  return arr.filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
};

/* -------------------------------- Endpoint -------------------------------- */
app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    if (req.method === "GET") return ok({ name: "import-run" });

    // POST
    let body: RunBody | undefined;
    try {
      body = (await req.json()) as RunBody;
    } catch {
      return fail("Invalid JSON body");
    }
    if (!body?.categoryIds?.length) return fail("categoryIds required");

    try {
      const publish = !!body.publish;
      const defaultStock = Number(body.defaultStock ?? 100);
      const forcedWooCategoryId = body.wooCategoryId ? Number(body.wooCategoryId) : undefined;
      const debug = !!body.debug || req.query.get("debug") === "1";
      const limit = Math.max(0, Number(body.limit ?? 0));

      // 1) Hämta produkter precis som PHP-pluggen: /part/getall med paginering
      let items: BritpartImportItem[] = await britpartGetAllBySubcategories(body.categoryIds);
      if (limit > 0) items = items.slice(0, limit);
      if (!items.length) return ok({ total: 0, created: 0, updated: 0, skipped: 0, errors: [], sample: [] });

      let created = 0, updated = 0, skipped = 0;
      const errors: any[] = [];
      const sample: any[] = [];

      for (const raw of items) {
        const sku = pickSku(raw);
        if (!sku) { skipped++; continue; }

        try {
          const existingId = await wcFindProductIdBySku(sku).catch(() => null);
          const imageUrls = urlsFromItem(raw);
          const name = (raw.name && String(raw.name).trim()) || sku;
          const description = (raw.description && String(raw.description)) || "";

          // PHP satte pris 0 -> vi speglar det här
          const regular_price = "0";

          // Woo-kategori: använd explicit wooCategoryId om satt annars försök med item.categoryId
          const targetCatId = forcedWooCategoryId ?? (raw.categoryId ? Number(raw.categoryId) : undefined);

          const basePayload: any = {
            name,
            sku,
            description,
            manage_stock: true,
            stock_status: "instock",
            stock_quantity: defaultStock,
            regular_price,
          };
          if (targetCatId) basePayload.categories = [{ id: targetCatId }];
          if (imageUrls.length) basePayload.images = imageUrls.map((src: string) => ({ src }));
          if (publish) basePayload.status = "publish";

          if (debug) {
            const preview = { ...basePayload, __existingId: existingId };
            if (sample.length < 8) sample.push({ action: existingId ? "would update" : "would create", sku, preview });
            if (existingId) updated++; else created++;
            continue;
          }

          if (!existingId) {
            const res = await wcCreateProduct(basePayload);
            if (!res.ok) {
              const txt = await res.text().catch(() => "");
              errors.push({ sku, error: `create ${res.status}: ${txt.slice(0, 400)}` });
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
              regular_price,
            };
            if (targetCatId) updatePayload.categories = basePayload.categories;
            if (imageUrls.length) updatePayload.images = imageUrls.map((src: string) => ({ src }));
            if (publish) updatePayload.status = "publish";

            const res = await wcUpdateProduct(Number(existingId), updatePayload);
            if (!res.ok) {
              const txt = await res.text().catch(() => "");
              errors.push({ sku, id: existingId, error: `update ${res.status}: ${txt.slice(0, 400)}` });
              continue;
            }
            updated++;
            if (sample.length < 5) sample.push({ action: "updated", sku, id: existingId, preview: updatePayload });
          }
        } catch (err: any) {
          errors.push({ sku: raw?.sku, error: err?.message || String(err) });
        }
      }

      return ok({ total: items.length, created, updated, skipped, errors, sample, debug });
    } catch (e: any) {
      return fail(e?.message || "Backend call failure");
    }
  },
});
