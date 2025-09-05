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
    if (req.method === "GET") {
      // Liten GET-ping
      if (req.query.get("ping") === "1") return ok({ name: "import-run", ping: "alive" });
      return ok({ name: "import-run" });
    }

    // ---- POST ----
    // Tidig ping/diag som INTE importerar något (för att ringa in var 500 uppstår)
    if (req.query.get("ping") === "1") {
      return ok({ step: "pre-body", method: "POST" });
    }

    let body: RunBody | undefined;
    try {
      body = (await req.json()) as RunBody;
    } catch {
      return fail("Invalid JSON body");
    }
    if (!body?.categoryIds?.length) return fail("categoryIds required");

    // Ännu en tidig diag innan imports
    if (req.query.get("stage") === "pre") {
      return ok({ step: "after-body", body });
    }

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

      // Helpers
      const pickSku = (it: any): string | undefined =>
        typeof it?.sku === "string" && it.sku.trim() ? it.sku.trim() : undefined;

      const urlsFromItem = (it: any): string[] => {
        const out: string[] = [];
        // 1) imageUrl som sträng (vanligast från /part/getall)
        if (typeof it?.imageUrl === "string" && /^https?:\/\//i.test(it.imageUrl)) out.push(it.imageUrl);
        // 2) imageUrls som lista
        if (Array.isArray((it as any).imageUrls)) {
          for (const u of (it as any).imageUrls) if (typeof u === "string" && /^https?:\/\//i.test(u)) out.push(u);
        }
        // 3) images [{url|src|href}]
        if (Array.isArray(it?.images)) {
          for (const x of it.images) {
            const u = x?.url || x?.src || x?.href;
            if (typeof u === "string" && /^https?:\/\//i.test(u)) out.push(u);
          }
        }
        // unika
        return Array.from(new Set(out));
      };

      const publish = !!body.publish;
      const defaultStock = Number.isFinite(Number(body.defaultStock)) ? Number(body.defaultStock) : 100;
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
          const regular_price = "0"; // vi speglar PHP-beteendet

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
        const k = Object.keys(process.env || {}).filter((x) =>
          /BRITPART|WC_|WOO|CONSUMER|SECRET|KEY|BASE|URL|WP_URL/i.test(x)
        );
        result.diagnostics = { envKeys: k.sort(), node: process.version };
      }
      return ok(result);
    } catch (e: any) {
      const diag = diagFlag
        ? { message: e?.message || String(e), stack: (e && e.stack) || undefined, node: process.version }
        : undefined;
      return fail(e?.message || "Backend call failure", { diagnostics: diag });
    }
  },
});
