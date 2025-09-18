import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcGetJSON, wcPostJSON } from "../shared/wc";

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
  /** 'set' = ersätt helt, 'add' = lägg till, 'remove' = ta bort */
  action: "set" | "add" | "remove";
  categoryId: number;
  /** Torrkörning: bygg plan men uppdatera inte i Woo */
  dryRun?: boolean;
};

type WCProductLite = { id: number; categories?: Array<{ id: number; name?: string }>; };

async function fetchProductsLite(ids: number[], ctx: InvocationContext): Promise<Map<number, WCProductLite>> {
  // Hämta i parallell men lagom throttle. Använder _fields för min payload.
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

function nextCategories(
  current: Array<{ id: number }> | undefined,
  action: "set" | "add" | "remove",
  catId: number
): Array<{ id: number }> {
  const cur = Array.isArray(current) ? current.map(c => ({ id: Number(c.id) })) : [];
  if (action === "set") return [{ id: catId }];

  const set = new Set(cur.map(c => c.id));
  if (action === "add") {
    set.add(catId);
    return Array.from(set).map(id => ({ id }));
  }
  // remove
  set.delete(catId);
  return Array.from(set).map(id => ({ id }));
}

async function postBatchUpdates(updates: Array<{ id: number; categories: Array<{ id: number }> }>, ctx: InvocationContext) {
  let updated = 0;
  const failed: number[] = [];

  for (let i = 0; i < updates.length; i += 80) {
    const chunk = updates.slice(i, i + 80);
    try {
      const res = await wcPostJSON<{ update?: Array<{ id: number }> }>(`/products/batch`, { update: chunk });
      updated += Array.isArray(res.update) ? res.update.length : 0;
    } catch (e) {
      ctx.warn?.(`batch update fail (${chunk.length}): ${emsg(e)} → fallback per item`);
      // Fallback per produkt
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
      const action = body?.action;
      const categoryId = Number(body?.categoryId || 0);
      const dryRun = !!body?.dryRun;

      if (!productIds.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, where, error: "productIds saknas" } };
      }
      if (!["set", "add", "remove"].includes(String(action))) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, where, error: "ogiltig action" } };
      }
      if (!Number.isFinite(categoryId) || categoryId <= 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, where, error: "categoryId saknas/ogiltig" } };
      }

      where = "fetch-products";
      const prodMap = await fetchProductsLite(productIds, ctx);
      const notFoundIds = productIds.filter(id => !prodMap.has(id));

      where = "plan";
      const plan = productIds
        .map(id => {
          const p = prodMap.get(id);
          if (!p) return null;
          const before = Array.isArray(p.categories) ? p.categories.map(c => c.id) : [];
          const after = nextCategories(p.categories, action as any, categoryId).map(c => c.id);
          const same = before.join(",") === after.join(",");
          return { id, before, after, same };
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
