import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  britpartGetPartCodesForCategoriesFiltered,
  britpartGetBasicForSkus,
  getCategory, // <-- nytt för att kunna hämta namn vid on-demand
} from "../shared/britpart";
import {
  wcFindProductIdBySku,
  wcPostJSON,
  wcPutJSON,
  wcGetJSON,
  WooUpdate,
} from "../shared/wc";

/* --------------------------------------------------------------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));
const isHttpUrl = (s?: string) => typeof s === "string" && /^https?:\/\//i.test(s || "");
const validImage = (url?: string) => isHttpUrl(url);
const canon = (u?: string) => {
  if (!u) return null;
  try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return null; }
};

/* --------------------- Woo-cat helpers (auto ensure) --------------------- */
const slugFor = (bpId: number) => `bp-${bpId}`;

async function wcFindCategoryIdBySlug(slug: string): Promise<number | null> {
  const rows = await wcGetJSON<any[]>(`/products/categories?slug=${encodeURIComponent(slug)}&per_page=100`);
  if (Array.isArray(rows) && rows[0]?.id) return Number(rows[0].id);
  return null;
}

/** Skapa/uppdatera en Woo-kategori för given Britpart-id, returnera Woo-id. */
async function ensureWooCategoryForBritpart(bpId: number, parentWcId?: number | null): Promise<number> {
  const slug = slugFor(bpId);
  const existingId = await wcFindCategoryIdBySlug(slug);
  const bp = await getCategory(bpId);
  const name = bp?.title ?? String(bpId);
  const parent = parentWcId ?? 0;

  if (!existingId) {
    const created = await wcPostJSON<any>(`/products/categories`, {
      name, slug, parent,
      description: `Britpart kategori #${bpId}`,
    });
    return Number(created?.id);
  } else {
    // uppdatera namn/parent om det skiljer sig
    const term = await wcGetJSON<any>(`/products/categories/${existingId}`);
    const needName = name !== (term?.name ?? "");
    const needParent = parent !== Number(term?.parent ?? 0);
    if (needName || needParent) {
      await wcPutJSON(`/products/categories/${existingId}`, { name, parent });
    }
    return existingId;
  }
}

/** Bygg en cache för alla bp-categoryIds som används i aktuell import-körning. */
async function mapBritpartCatsToWoo(
  allBpCatIds: number[],
): Promise<Map<number, number>> {
  const unique = Array.from(new Set(allBpCatIds.filter((n) => Number.isFinite(n) && n > 0)));
  const map = new Map<number, number>();

  // Föräldrar i Britpart-API:t kräver att vi vet parenten. Vi använder sync-endpointen
  // för fullständig träd-synk. Här vid "on-demand" skapar vi dem utan parent (root),
  // vilket räcker för att kunna kategorisera produkten. Kunden kan sedan köra
  // sync-britpart-categories (apply=true) för att sätta hierarchy korrekt.
  for (const bpId of unique) {
    const wcId = await ensureWooCategoryForBritpart(bpId, null);
    map.set(bpId, wcId);
  }
  return map;
}

function wcCatsFromMap(categoryIds: number[] | undefined, m: Map<number, number>) {
  if (!Array.isArray(categoryIds) || !categoryIds.length) return undefined;
  const ids = Array.from(
    new Set(categoryIds.map((bp) => m.get(bp)).filter((x): x is number => typeof x === "number"))
  );
  return ids.length ? ids.map((id) => ({ id })) : undefined;
}

/* -------------------------- Batch helpers (samma) ------------------------- */
async function createProductsSafe(items: any[], ctx: InvocationContext) {
  let created = 0;
  const idsBySku: Record<string, number> = {};
  const failedSkus: string[] = [];

  for (let i = 0; i < items.length; i += 40) {
    const chunk = items.slice(i, i + 40);
    try {
      const res = await wcPostJSON<{ create?: Array<{ id: number; sku?: string }> }>(
        `/products/batch`, { create: chunk }
      );
      const arr = Array.isArray(res.create) ? res.create : [];
      for (const c of arr) if (c?.id && c?.sku) idsBySku[c.sku] = Number(c.id);
      created += arr.length;
    } catch (e: any) {
      ctx.warn?.(`Batch create fail (${chunk.length} st): ${emsg(e)} → fallback per item`);
      for (const p of chunk) {
        try {
          const single = await wcPostJSON<{ id: number; sku?: string }>(`/products`, p);
          if (single?.id) {
            created++;
            if (single.sku) idsBySku[single.sku] = Number(single.id);
          }
        } catch (ee: any) {
          const text = emsg(ee);
          if (/sku/i.test(text) && /exist/i.test(text)) {
            const id = await wcFindProductIdBySku(p.sku);
            if (id) { idsBySku[p.sku] = id; continue; }
          }
          failedSkus.push(p.sku);
          ctx.warn?.(`Create fail ${p.sku}: ${text}`);
        }
      }
    }
  }
  return { created, idsBySku, failedSkus };
}

async function updateProductsSafe(updates: WooUpdate[], ctx: InvocationContext) {
  let updated = 0;
  const failedIds: number[] = [];

  for (let i = 0; i < updates.length; i += 80) {
    const chunk = updates.slice(i, i + 80);
    try {
      const res = await wcPostJSON<{ update?: Array<{ id: number }> }>(
        `/products/batch`, { update: chunk }
      );
      updated += Array.isArray(res.update) ? res.update.length : 0;
    } catch (e: any) {
      ctx.warn?.(`Batch update fail (${chunk.length} st): ${emsg(e)} → fallback per item`);
      for (const u of chunk) {
        try { await wcPutJSON(`/products/${u.id}`, u); updated++; }
        catch (ee: any) { failedIds.push(u.id); ctx.warn?.(`Update fail id=${u.id}: ${emsg(ee)}`); }
      }
    }
  }
  return { updated, failedIds };
}

/* ----------------------------- Types & handler ---------------------------- */
type ImportRunBody = {
  ids: number[];
  pageSize?: number;
  leafIds?: number[];
  restrictSkus?: string[];
  roundingMode?: "none" | "nearest" | "up" | "down";
  roundTo?: number;
};

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    let where = "start";
    try {
      const body = (await req.json()) as ImportRunBody;
      const ids = body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No ids" } };
      }

      const PAGE_MAX = 50;
      const pageSize = Math.max(1, Math.min(Number(body?.pageSize || 25), PAGE_MAX));

      /* 1) Samla SKU */
      where = "collect-skus";
      let allSkus = Array.from(new Set(
        (await britpartGetPartCodesForCategoriesFiltered(ids, body.leafIds)).map(String)
      ));
      if (Array.isArray(body.restrictSkus) && body.restrictSkus.length) {
        const allow = new Set(body.restrictSkus.map(String));
        allSkus = allSkus.filter((s) => allow.has(s));
      }

      /* 2) Filtrera bort existerande så vi tar “nästa sida” vid nästa körning */
      where = "filter-existing";
      const existingAll = new Set<string>();
      {
        let i = 0;
        const conc = 10;
        async function worker() {
          while (i < allSkus.length) {
            const sku = allSkus[i++];
            try {
              const id = await wcFindProductIdBySku(sku);
              if (id) existingAll.add(sku);
            } catch (e) { ctx.warn?.(`lookup(all) fail ${sku}: ${emsg(e)}`); }
          }
        }
        await Promise.all(Array.from({ length: conc }, worker));
      }
      const pendingSkus = allSkus.filter((s) => !existingAll.has(s));
      const skus = pendingSkus.slice(0, pageSize);
      const remainingSkus = Math.max(0, pendingSkus.length - skus.length);

      if (!skus.length) {
        return {
          status: 200, headers: CORS, jsonBody: {
            ok: true, where: "nothing-to-do",
            selectedCategoryIds: ids, usedLeafIds: body.leafIds ?? [],
            restrictedToSkus: body.restrictSkus?.length ?? 0,
            pageSize, processedSkus: 0,
            totalSkus: allSkus.length, remainingSkus, hasMore: remainingSkus > 0,
            exists: existingAll.size, created: 0, updatedWithMeta: 0,
            invalidImageUrls: 0, createFailedSkus: [], updateFailedIds: [],
            sampleSkus: allSkus.slice(0, 10),
          }
        };
      }

      /* 3) Basdata */
      where = "fetch-basics";
      const basics = await britpartGetBasicForSkus(skus);

      /* 4) Mappa/Skapa Woo-kategorier för ALLA bpCategoryIds som förekommer i denna chunk */
      where = "ensure-categories";
      const allBpCatIds: number[] = [];
      for (const sku of skus) {
        const arr = (basics as any)[sku]?.categoryIds as number[] | undefined;
        if (Array.isArray(arr)) allBpCatIds.push(...arr);
      }
      const wcMap = await mapBritpartCatsToWoo(allBpCatIds);

      /* 5) Skapa saknade produkter (inkl kategorier) */
      where = "create";
      const createPayloads: any[] = skus.map((sku) => {
        const b = basics[sku] || {};
        const c = canon(b.imageUrl);
        const meta = [];
        if (b.imageUrl) meta.push({ key: "_lr_source_image_url", value: b.imageUrl });
        if (c) meta.push({ key: "_lr_source_image_canon", value: c });
        if ((b as any).imageSource) meta.push({ key: "_lr_source", value: (b as any).imageSource });
        if (Array.isArray(b.categoryIds)) meta.push({ key: "_lr_britpart_categories", value: JSON.stringify(b.categoryIds) });

        const cats = wcCatsFromMap((b as any).categoryIds, wcMap);

        const payload: any = {
          name: (b.title && b.title.trim()) || sku,
          sku,
          type: "simple",
          status: "draft",
          description: b.description,
          short_description: b.description,
          meta_data: meta.length ? meta : undefined,
        };
        if (validImage(b.imageUrl)) payload.images = [{ src: b.imageUrl, position: 0 }];
        if (cats) payload.categories = cats;

        return payload;
      });

      const { created, idsBySku, failedSkus } = await createProductsSafe(createPayloads, ctx);

      /* 6) (valfritt) uppdatera redan existerande i denna chunk – hoppar här */
      where = "update";
      const updates: WooUpdate[] = [];
      const { updated, failedIds } = await updateProductsSafe(updates, ctx);

      /* 7) Svar */
      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          where: "done",
          selectedCategoryIds: ids,
          usedLeafIds: body.leafIds ?? [],
          restrictedToSkus: body.restrictSkus?.length ?? 0,
          pageSize,
          processedSkus: skus.length,
          totalSkus: allSkus.length,
          remainingSkus,
          hasMore: remainingSkus > 0,
          exists: existingAll.size,
          created,
          updatedWithMeta: updated,
          invalidImageUrls: 0,
          createFailedSkus: failedSkus,
          updateFailedIds: failedIds,
          sampleSkus: skus.slice(0, 10),
        },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: emsg(e) } };
    }
  },
});
