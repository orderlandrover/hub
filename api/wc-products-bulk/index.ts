import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcGetJSON, wcPostJSON, wcPutJSON } from "../shared/wc";
import { wcFindProductIdBySku } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));

type Body = {
  ids?: number[];
  skus?: string[];
  /** Ersätt produktens kategorier helt med dessa */
  setCategoryIds?: number[];
  /** Lägg till kategorier (behåll befintliga) */
  addCategoryIds?: number[];
};

app.http("wc-products-bulk", {
  route: "wc-products-bulk",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    let where = "start";
    try {
      const body = (await req.json()) as Body;
      const ids = new Set<number>();

      // Resolve produkt-ID från SKU
      if (Array.isArray(body?.skus)) {
        for (const sku of body.skus) {
          try {
            const id = await wcFindProductIdBySku(String(sku));
            if (id) ids.add(id);
          } catch (e) {
            ctx.warn?.(`id-from-sku fail ${sku}: ${emsg(e)}`);
          }
        }
      }
      if (Array.isArray(body?.ids)) {
        for (const id of body.ids) if (Number(id)) ids.add(Number(id));
      }

      const productIds = Array.from(ids);
      if (!productIds.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No product ids/skus" } };
      }

      // Normalisera input
      const setCat: number[] | undefined =
        Array.isArray(body?.setCategoryIds) && body.setCategoryIds.length
          ? body.setCategoryIds.map((n) => Number(n)).filter(Boolean)
          : undefined;

      const addCat: number[] | undefined =
        !setCat && Array.isArray(body?.addCategoryIds) && body.addCategoryIds.length
          ? body.addCategoryIds.map((n) => Number(n)).filter(Boolean)
          : undefined;

      if (!setCat && !addCat) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "setCategoryIds or addCategoryIds required" } };
      }
      if (setCat && addCat) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "Use either setCategoryIds or addCategoryIds (not both)" } };
      }

      where = "prepare-updates";
      type Update = { id: number; categories: { id: number }[] };
      const updates: Update[] = [];

      if (setCat) {
        for (const pid of productIds) {
          updates.push({ id: pid, categories: setCat.map((id) => ({ id })) });
        }
      } else if (addCat && addCat.length) {
  // Narrow to a definite array for the closure
  const addCatArr: number[] = addCat;

  // Hämta befintliga kategorier per produkt och addera
  let i = 0;
  const conc = 8;
  const pending: Promise<void>[] = [];
  const results: Update[] = [];

  async function worker() {
    while (i < productIds.length) {
      const pid = productIds[i++];
      try {
        const prod = await wcGetJSON<any>(`/products/${pid}?_fields=id,categories`);
        const cur = Array.isArray(prod?.categories)
          ? prod.categories.map((c: any) => Number(c?.id)).filter(Boolean)
          : [];

        // ✅ No union type here — both spreads are arrays
        const merged = Array.from(new Set<number>([...cur, ...addCatArr]));
        results.push({ id: pid, categories: merged.map((id) => ({ id })) });
      } catch (e) {
        ctx.warn?.(`get product ${pid} fail: ${emsg(e)}`);
        // ✅ Also safe here
        results.push({ id: pid, categories: addCatArr.map((id) => ({ id })) });
      }
    }
  }

  for (let k = 0; k < conc; k++) pending.push(worker());
  await Promise.all(pending);

  updates.push(...results);
}

      where = "batch-update";
      let updated = 0;
      for (let i = 0; i < updates.length; i += 80) {
        const chunk = updates.slice(i, i + 80);
        try {
          const res = await wcPostJSON<{ update?: Array<{ id: number }> }>(`/products/batch`, { update: chunk });
          updated += Array.isArray(res.update) ? res.update.length : 0;
        } catch (e: any) {
          ctx.warn?.(`batch fail (${chunk.length}) ${emsg(e)} — fallback per item`);
          for (const u of chunk) {
            try {
              await wcPutJSON(`/products/${u.id}`, u);
              updated++;
            } catch (ee: any) {
              ctx.warn?.(`update fail id=${u.id}: ${emsg(ee)}`);
            }
          }
        }
      }

      return { status: 200, headers: CORS, jsonBody: { ok: true, where: "done", count: productIds.length, updated } };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: emsg(e) } };
    }
  },
});
