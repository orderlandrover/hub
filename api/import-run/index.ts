// api/import-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

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
  wooCategoryId?: number; // om satt används denna Woo-kategori för alla produkter
  debug?: boolean;        // true = skriv inte till Woo, returnera bara previews
  limit?: number;         // max antal produkter (för test)
};

type ImportResult = {
  ok: boolean;
  total?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{ sku?: string; id?: number; error: string }>;
  sample?: any[];
  debug?: boolean;
  diagnostics?: any;
  error?: string;
};

/* --------------------------- Hjälpare: svar --------------------------- */
function ok(data: any): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: true, ...data } };
}
function fail(message: string, extra?: any): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: false, error: message, ...extra } };
}

/* -------------------------------- Endpoint -------------------------------- */
app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    if (req.method === "GET") return ok({ name: "import-run" });

    // ---- POST ----
    let body: RunBody | undefined;
    try {
      body = (await req.json()) as RunBody;
    } catch {
      return fail("Invalid JSON body");
    }
    if (!body?.categoryIds?.length) return fail("categoryIds required");

    // Diagnostikflagga (via query eller body.debug)
    const diagFlag = req.query.get("diag") === "1" || !!body.debug;

    try {
      // *** Dynamiska imports inne i try → även modulfel fångas ***
      const { britpartGetAllBySubcategories } = await import("../shared/britpart");
      const { wcFindProductIdBySku, wcFetch } = await import("../shared/wc");

      // Små Woo-wrappers med path-fallback
      const wcCreateProduct = async (payload: any): Promise<Response> => {
        let res = await wcFetch("/products", { method: "POST", body: JSON.stringify(payload) });
        if (res.status === 404) res = await wcFetch("products", { method: "POST", body: JSON.stringify(payload) });
        return res;
      };
      const wcUpdateProduct = async (id: number, payload: any): Promise<Response> => {
        let res = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        if (res.status === 404) res = await wcFetch(`products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        return res;
      };

      // Små helpers (typade för TS)
      const pickSku = (it: any): string | undefined =>
        typeof it?.sku === "string" && it.sku.trim() ? it.sku.trim() : undefined;

      const urlsFromItem = (it: any): string[] => {
        const arr: unknown[] = Array.isArray((it as any).imageUrls)
          ? (it as any).imageUrls
          : (it.images?.map((x: any) => x?.url || x?.src || x?.href) || []);
        return arr.filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
      };

      const publish = !!body.publish;
      const defaultStock = Number(body.defaultStock ?? 100);
      const forcedWooCategoryId = body.wooCategoryId ? Number(body.wooCategoryId) : undefined;
      const debug = !!body.debug || req.query.get("debug") === "1";
      const limit = Math.max(0, Number(body.limit ?? 0));

      // 1) Hämta precis som gamla PHP-pluggen: /part/getall per subkategori, med paginering
      let items: any[] = await britpartGetAllBySubcategories(body.categoryIds);
      if (limit > 0) items = items.slice(0, limit);
      if (!items.length) return ok({ total: 0, created: 0, updated: 0, skipped: 0, errors: [], sample: [], debug });

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
          const regular_price = "0"; // PHP-varianten satte _price/_regular_price = 0

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

      const result: ImportResult = { ok: true, total: items.length, created, updated, skipped, errors, sample, debug };
      if (diagFlag) {
        // Minimal diagnos: visa vilka env-nycklar som verkar finnas (maskerad)
        const k = Object.keys(process.env || {}).filter((x) =>
          /BRITPART|WC_|WOO|CONSUMER|SECRET|KEY|BASE|URL/i.test(x)
        );
        result.diagnostics = { envKeys: k.sort(), node: process.version };
      }
      return ok(result);
    } catch (e: any) {
      // Här hamnar även modulfel (t.ex. i shared/britpart.ts eller shared/wc.ts)
      const diag = diagFlag
        ? {
            message: e?.message || String(e),
            stack: (e && e.stack) || undefined,
            node: process.version,
          }
        : undefined;
      return fail(e?.message || "Backend call failure", { diagnostics: diag });
    }
  },
});
