// api/wc-products-bulk/index.ts
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
  HttpMethod,
  HttpFunctionOptions,
} from "@azure/functions";
import { wcGetJSON, wcPostJSON, wcGetAllCategories } from "../shared/wc";

/* --------------------------------------------------------------- */
/* CORS                                                            */
/* --------------------------------------------------------------- */
function cors(req: HttpRequest): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": o || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    ...(o ? { Vary: "Origin" } : {}),
  };
}
const emsg = (e: any) => (e?.message ? String(e.message) : String(e));

/* --------------------------------------------------------------- */
/* Types                                                           */
/* --------------------------------------------------------------- */
type BulkAction = "set" | "add" | "remove";

type BulkBody = {
  productIds?: unknown;
  action?: unknown;
  categoryIds?: unknown;
  dryRun?: unknown;
};

type WCProductLite = { id: number; categories?: Array<{ id: number; name?: string }> };
type WCCategory = { id: number };

/* --------------------------------------------------------------- */
/* Helpers                                                         */
/* --------------------------------------------------------------- */

function uniqSorted(nums: number[]): number[] {
  const s = new Set<number>();
  for (const n of nums) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) s.add(v);
  }
  return Array.from(s).sort((a, b) => a - b);
}

/** Tar emot array av tal/strings/objekt {id}, eller CSV-string. Returnerar unika ID:n. */
function parseIdList(input: unknown): number[] {
  const out: number[] = [];

  if (Array.isArray(input)) {
    for (const it of input) {
      if (it == null) continue;
      if (typeof it === "number" || typeof it === "string") {
        const v = Number(it);
        if (Number.isFinite(v) && v > 0) out.push(v);
      } else if (typeof it === "object" && "id" in (it as any)) {
        const v = Number((it as any).id);
        if (Number.isFinite(v) && v > 0) out.push(v);
      }
    }
    return uniqSorted(out);
  }

  if (typeof input === "string") {
    // Stöd för "1,2,3" eller "1 2 3"
    const parts = input.split(/[,\s]+/).filter(Boolean);
    for (const p of parts) {
      const v = Number(p);
      if (Number.isFinite(v) && v > 0) out.push(v);
    }
    return uniqSorted(out);
  }

  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0 ? [input] : [];
  }

  return [];
}

function parseBool(input: unknown): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") return /^(1|true|yes|on)$/i.test(input.trim());
  if (typeof input === "number") return input === 1;
  return false;
}

/** Tillåt även synonymer och fallback. */
function parseAction(input: unknown): BulkAction | undefined {
  if (typeof input === "string") {
    const v = input.trim().toLowerCase();
    if (v === "set" || v === "replace") return "set";
    if (v === "add" || v === "append") return "add";
    if (v === "remove" || v === "delete" || v === "del") return "remove";
  }
  return undefined;
}

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

function nextCategories(
  current: Array<{ id: number }> | undefined,
  action: BulkAction,
  catIds: number[]
): Array<{ id: number }> {
  const cur = Array.isArray(current) ? current.map((c: { id: number }) => Number(c.id)) : [];
  const cats = uniqSorted(catIds);

  if (action === "set") return cats.map((id) => ({ id }));

  const set = new Set(cur);
  if (action === "add") {
    for (const id of cats) set.add(id);
    return uniqSorted(Array.from(set)).map((id) => ({ id }));
  }

  // remove
  for (const id of cats) set.delete(id);
  return uniqSorted(Array.from(set)).map((id) => ({ id }));
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

const opts: HttpFunctionOptions = {
  route: "wc-products-bulk",
  methods: ["POST", "OPTIONS"] as HttpMethod[],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    // CORS preflight
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    let where = "start";
    try {
      const body = (await req.json()) as BulkBody | undefined;

      // Tillåt flera nycklar/format från frontenden:
      const productIds =
        parseIdList(body?.productIds) ||
        parseIdList((body as any)?.ids) ||
        parseIdList((body as any)?.products) ||
        [];

      const action =
        parseAction(body?.action) ||
        parseAction((body as any)?.mode) ||
        parseAction((body as any)?.op) ||
        ("set" as BulkAction); // defaulta till "set"

      const rawCatInput =
        (body?.categoryIds ??
          (body as any)?.categories ??
          (body as any)?.category_ids ??
          (body as any)?.catIds ??
          (body as any)?.cats ??
          (body as any)?.categoryId ??
          (body as any)?.category) ?? [];
      const categoryIds = parseIdList(rawCatInput);

      const dryRun =
        parseBool(body?.dryRun) ||
        parseBool((body as any)?.probe) ||
        parseBool((body as any)?.test) ||
        false;

      // Grundvalidering
      if (!productIds.length) {
        return {
          status: 400,
          headers: cors(req),
          jsonBody: { ok: false, where, error: "productIds saknas/ogiltiga", received: { productIds: body?.productIds } },
        };
      }
      if (!["set", "add", "remove"].includes(action)) {
        return { status: 400, headers: cors(req), jsonBody: { ok: false, where, error: "ogiltig action", action } };
      }
      if (action !== "set" && !categoryIds.length) {
        return {
          status: 400,
          headers: cors(req),
          jsonBody: {
            ok: false,
            where,
            error: "categoryIds saknas/ogiltiga",
            receivedType: typeof rawCatInput,
            example: rawCatInput,
          },
        };
      }
      // För "set" tillåt att rensa alla kategorier om listan är tom (set []).

      /* ---------- Validera kategori-IDs mot Woo ---------- */
      where = "validate-categories";
      try {
        const allCats = (await wcGetAllCategories()) as WCCategory[];
        const wooIds = new Set<number>(
          allCats.map((c: WCCategory) => Number(c.id)).filter((n: number) => Number.isFinite(n))
        );
        const unknown = categoryIds.filter((id) => !wooIds.has(id));
        if (unknown.length) {
          return {
            status: 400,
            headers: cors(req),
            jsonBody: {
              ok: false,
              where,
              error: "Vissa categoryIds finns inte i Woo",
              unknownCategoryIds: unknown,
            },
          };
        }
      } catch (e) {
        // Om valideringen inte kan utföras (t.ex. nätfel), logga och fortsätt ändå.
        ctx.warn?.(`kategori-validering hoppades över: ${emsg(e)}`);
      }

      /* ---------- Läs produkter ---------- */
      where = "fetch-products";
      const prodMap = await fetchProductsLite(productIds, ctx);
      const notFoundIds = productIds.filter((id) => !prodMap.has(id));

      /* ---------- Bygg plan ---------- */
      where = "plan";
      const plan = productIds
        .map((id) => {
          const p = prodMap.get(id);
          if (!p) return null;
          const before = Array.isArray(p.categories) ? p.categories.map((c: { id: number }) => Number(c.id)) : [];
          const after =
            action === "set" ? categoryIds : nextCategories(p.categories, action, categoryIds).map((c: { id: number }) => c.id);
          const same = before.join(",") === uniqSorted(after).join(",");
          return { id, before: uniqSorted(before), after: uniqSorted(after), same };
        })
        .filter(Boolean) as Array<{ id: number; before: number[]; after: number[]; same: boolean }>;

      const toUpdate = plan
        .filter((p) => !p.same)
        .map((p) => ({ id: p.id, categories: p.after.map((id) => ({ id })) }));

      if (dryRun) {
        return {
          status: 200,
          headers: cors(req),
          jsonBody: {
            ok: true,
            where: "dry-run",
            updated: 0,
            failedIds: [],
            skipped: plan.filter((p) => p.same).map((p) => p.id),
            notFoundIds,
            plan,
          },
        };
      }

      if (!toUpdate.length) {
        return {
          status: 200,
          headers: cors(req),
          jsonBody: {
            ok: true,
            where: "no-op",
            updated: 0,
            skipped: plan.filter((p) => p.same).map((p) => p.id),
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
        headers: cors(req),
        jsonBody: {
          ok: true,
          where: "done",
          updated,
          skipped: plan.filter((p) => p.same).map((p) => p.id),
          failedIds: failed,
          notFoundIds,
          totalConsidered: plan.length,
        },
      };
    } catch (e: any) {
      return { status: 500, headers: cors(req), jsonBody: { ok: false, where, error: emsg(e) } };
    }
  },
};

app.http("wc-products-bulk", opts);
