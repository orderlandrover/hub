import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcGetJSON, wcPostJSON, wcGetAllCategories } from "../shared/wc";

/* --------------------------------------------------------------- */
/* CORS                                                            */
/* --------------------------------------------------------------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));

type BulkBody = {
  productIds: number[];
  /** 'set' = ersätter helt, 'add' = lägger till, 'remove' = tar bort */
  action: "set" | "add" | "remove";
  /** en eller flera Woo-kategori-ID:n */
  categoryIds: number[];
  /** Torrkörning: bygg plan men uppdatera inte i Woo */
  dryRun?: boolean;
};

type WCProductLite = { id: number; categories?: Array<{ id: number; name?: string }> };

/* --------------------------------------------------------------- */
/* Helpers                                                         */
/* --------------------------------------------------------------- */

async function fetchProductsLite(ids: number[], ctx: InvocationContext): Promise<Map<number, WCProductLite>> {
  const map = new Map<number, WCProductLite>();
  let i = 0;
  const conc = 10;

  async function worker() {
    while (i < ids.length) {
      const pid = ids[i++];
      try {
        const p = await wcGetJSON<WCProductLite>(`/products/${pid}?_fields=id,categories`);
        if (p?.id) map.set(p.id, { id: p.id, categories: Array.isArray(p.categories) ? p.categories : [] });
      } catch (e) {
        ctx.warn?.(`fetch product ${pid} fail: ${emsg(e)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return map;
}

function uniqSorted(nums: number[]): number[] {
  const s = new Set<number>();
  for (const n of nums) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) s.add(v);
  }
  return Array.from(s).sort((a, b) => a - b);
}

function nextCategories(
  current: Array<{ id: number }> | undefined,
  action: "set" | "add" | "remove",
  catIds: number[]
): Array<{ id: number }> {
  const cur = Array.isArray(current) ? current.map(c => Number(c.id)) : [];
  const cats = uniqSorted(catIds);

  if (action === "set") return cats.map(id => ({ id }));

  const set = new Set(cur);
  if (action === "add") {
    for (const id of cats) set.add(id);
    return uniqSorted(Array.from(set)).map(id => ({ id }));
  }

  // remove
  for (const id of cats) set.delete(id);
  return uniqSorted(Array.from(set)).map(id => ({ id }));
}

async function postBatchUpdates(
  updates: Array<{ id: number; categories: Array<{ id: number }> }>,
  ctx: InvocationContext
) {
  let updated = 0;
  const failed: number[] = [];

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    try {
      const res = await wcPostJSON<{ update?: Array<{ id: number }> }>(`/products/batch`, { update: chunk });
      updated += Array.isArray(res.update) ? res.update.length : 0;
    } catch (e) {
      ctx.warn?.(`batch update fail (${chunk.length}): ${emsg(e)} → fallback per item`);
      for (const u of chunk) {
        try {
          await wcPostJSON(`/products/batch`, { update: [u] });
          updated += 1;
        } catch (ee) {
          failed.push(u.id);
          ctx.warn?.(`update fail id=${u.id}: ${emsg(ee)}`);
        }
      }
    }
  }
  return { updated, failed };
}

/* --------------------------------------------------------------- */
/* Azure Function                                                  */
/* --------------------------------------------------------------- */

app.http("wc-products-bulk", {
  route: "wc-products-bulk",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    let where = "start";
    try {
      const body = (await req.json()) as BulkBody;

      const productIds = Array.isArray(body?.productIds)
        ? body.productIds.map(Number).filter(n => Number.isFinite(n) && n > 0)
        : [];
      const action = String(body?.action) as BulkBody["action"];
      const categoryIds = Array.isArray(body?.categoryIds)
        ? body.categoryIds.map(Number).filter(n => Number.isFinite(n) && n > 0)
        : [];
      const dryRun = !!body?.dryRun;

      if (!productIds.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, where, error: "productIds saknas" } };
      }
      if (!["set", "add", "remove"].includes(action)) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, where, error: "ogiltig action" } };
      }
      if (!categoryIds.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, where, error: "categoryIds saknas/ogiltiga" } };
      }

      /* ---------- Validera kategori-IDs mot Woo ---------- */
      where = "validate-categories";
      const allCats = await wcGetAllCategories(); // hämtar alla Woo-kategorier (paginerat)
      const wooIds = new Set<number>(allCats.map(c => Number(c.id)).filter(n => Number.isFinite(n)));
      const unknownCategoryIds = categoryIds.filter(id => !wooIds.has(id));
      if (unknownCategoryIds.length) {
        return {
          status: 400,
          headers: CORS,
          jsonBody: {
            ok: false,
            where,
            error: "Vissa categoryIds finns inte i Woo",
            unknownCategoryIds,
          },
        };
      }

      /* ---------- Läs produkter ---------- */
      where = "fetch-products";
      const prodMap = await fetchProductsLite(productIds, ctx);
      const notFoundIds = productIds.filter(id => !prodMap.has(id));

      /* ---------- Bygg plan ---------- */
      where = "plan";
      const plan = productIds
        .map(id => {
          const p = prodMap.get(id);
          if (!p) return null;
          const before = Array.isArray(p.categories) ? p.categories.map(c => Number(c.id)) : [];
          const after = nextCategories(p.categories, action, categoryIds).map(c => c.id);
          const same = before.join(",") === after.join(",");
          return { id, before: uniqSorted(before), after: uniqSorted(after), same };
        })
        .filter(Boolean) as Array<{ id: number; before: number[]; after: number[]; same: boolean }>;

      const toUpdate = plan
        .filter(p => !p.same)
        .map(p => ({ id: p.id, categories: p.after.map(id => ({ id })) }));

      if (dryRun) {
        return {
          status: 200,
          headers: CORS,
          jsonBody: {
            ok: true,
            where: "dry-run",
            updated: 0,
            failedIds: [],
            skipped: plan.filter(p => p.same).map(p => p.id),
            notFoundIds,
            plan,
          },
        };
      }

      if (!toUpdate.length) {
        return {
          status: 200,
          headers: CORS,
          jsonBody: {
            ok: true,
            where: "no-op",
            updated: 0,
            skipped: plan.filter(p => p.same).map(p => p.id),
            failedIds: [],
            notFoundIds,
            totalConsidered: plan.length,
          },
        };
      }

      /* ---------- Apply ---------- */
      where = "apply";
      const { updated, failed } = await postBatchUpdates(toUpdate, ctx);

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          where: "done",
          updated,
          skipped: plan.filter(p => p.same).map(p => p.id),
          failedIds: failed,
          notFoundIds,
          totalConsidered: plan.length,
        },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: emsg(e) } };
    }
  },
});
