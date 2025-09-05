// api/import-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetAllBySubcategories, BritpartImportItem } from "../shared/britpart";
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
  wooCategoryId?: number;
  debug?: boolean;      // true = skriv inte till Woo, returnera bara previews
  limit?: number;       // max antal produkter (för test)
};

type ImportResult = {
  ok: true;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ sku?: string; id?: number; error: string }>;
  sample: any[];
  debug: boolean;
  diagnostics?: any;
};

/* --------------------------- Svarshjälpare --------------------------- */
function jsonOk(data: Record<string, any> = {}): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: true, ...data } };
}
function jsonFail(message: string, extra?: Record<string, any>): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: false, error: message, ...(extra || {}) } };
}

/* -------------------------- Små helpers -------------------------- */

function pickSku(it: BritpartImportItem | any): string | undefined {
  const v = it?.sku ?? it?.code;
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function urlsFromItem(it: BritpartImportItem | any): string[] {
  const urls = new Set<string>();

  // Våra normaliserade fält
  if (Array.isArray((it as any).imageUrls)) {
    for (const u of (it as any).imageUrls) {
      if (typeof u === "string" && /^https?:\/\//i.test(u)) urls.add(u);
    }
  }
  if (typeof (it as any).imageUrl === "string" && /^https?:\/\//i.test((it as any).imageUrl)) {
    urls.add((it as any).imageUrl);
  }

  // Fallback från andra former
  const assets = (it as any).images || (it as any).gallery || (it as any).media;
  if (Array.isArray(assets)) {
    for (const a of assets) {
      const cand = a?.url || a?.src || a?.href;
      if (typeof cand === "string" && /^https?:\/\//i.test(cand)) urls.add(cand);
    }
  }

  return Array.from(urls);
}

/* ------------------------------- Endpoint ------------------------------- */

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    // Preflight
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    // Ping
    if (req.method === "GET") {
      if (req.query.get("ping") === "1") return jsonOk({ name: "import-run", ping: "alive" });
      return jsonOk({ name: "import-run" });
    }

    // ---- POST ----
    let body: RunBody | undefined;
    try {
      body = (await req.json()) as RunBody;
    } catch {
      return jsonFail("Invalid JSON body");
    }
    if (!body?.categoryIds?.length) return jsonFail("categoryIds required");

    const diagFlag = req.query.get("diag") === "1" || !!body.debug;
    const publish = !!body.publish;
    const defaultStock = Number(body.defaultStock ?? 100);
    const forcedWooCategoryId = body.wooCategoryId ? Number(body.wooCategoryId) : undefined;
    const debug = !!body.debug || req.query.get("debug") === "1";
    const limit = Math.max(0, Number(body.limit ?? 0));

    try {
      // 1) Hämta produkter från Britpart via GETALL (som PHP-plugin)
      let items: BritpartImportItem[] = await britpartGetAllBySubcategories(
        body.categoryIds.map((n) => Number(n))
      );
      if (limit > 0) items = items.slice(0, limit);
      if (!items.length) {
        return jsonOk({
          total: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          sample: [],
          debug,
        } as Partial<ImportResult> as any);
      }

      let created = 0, updated = 0, skipped = 0;
      const errors: Array<{ sku?: string; id?: number; error: string }> = [];
      const sample: any[] = [];

      // Woo wrappers (tål både "/products" och "products")
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

      for (const raw of items) {
        const sku = pickSku(raw);
        if (!sku) { skipped++; continue; }

        try {
          const existingId = await wcFindProductIdBySku(sku).catch(() => null);
          const imageUrls = urlsFromItem(raw);
          const name = (raw.name && String(raw.name).trim()) || sku;
          const description = (raw.description && String(raw.description)) || "";
          const regular_price = "0"; // baseline som PHP-pluginen

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

      const result: ImportResult = {
        ok: true,
        total: items.length,
        created,
        updated,
        skipped,
        errors,
        sample,
        debug,
      };

      if (diagFlag) {
        const envKeys = Object.keys(process.env || {}).filter((x) =>
          /BRITPART|WP_URL|WC_|WOO|CONSUMER|SECRET|KEY|BASE|URL/i.test(x)
        ).sort();
        (result as any).diagnostics = { envKeys, node: process.version };
      }

      return jsonOk(result as any);
    } catch (e: any) {
      const diagnostics = diagFlag
        ? { message: e?.message || String(e), stack: e?.stack, node: process.version }
        : undefined;
      return jsonFail(e?.message || "Backend call failure", { diagnostics });
    }
  },
});
