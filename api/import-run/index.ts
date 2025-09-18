import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  britpartGetPartCodesForCategoriesFiltered,
  britpartGetBasicForSkus,
} from "../shared/britpart";
import {
  wcFindProductIdBySku,
  wcPostJSON,
  wcPutJSON,
  wcGetJSON,
  WooUpdate,
} from "../shared/wc";

/* --------------------------------------------------------------- */
/* CORS + utils                                                    */
/* --------------------------------------------------------------- */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));
const isHttpUrl = (s?: string) => typeof s === "string" && /^https?:\/\//i.test(s || "");
/** Woo sideloadar själv → http(s) räcker som valid bildkälla */
const validImage = (url?: string) => isHttpUrl(url);

/** Kanonisk bild-URL (utan query) för att känna igen samma källa mellan körningar */
const canon = (u?: string) => {
  if (!u) return null;
  try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return null; }
};

/* --------------------------------------------------------------- */
/* Britpart→Woo kategori-mappning                                  */
/* --------------------------------------------------------------- */
/**
 * 1) Direkt ID-mappning (Britpart-ID -> Woo-ID)
 * 2) Namnmappning (Britpart-ID -> Woo-kategorins namn) som slås upp mot Woo
 * 3) Fallback: om en Woo-kategori heter exakt t.ex. "46" så mappas Britpart 46 dit
 */

const BRITPART_TO_WC: Record<number, number> = {
  // Exempel:
  // 91: 123, // Britpart 91 -> Woo ID 123
};

const BRITPART_TO_WC_NAMES: Record<number, string> = {
  // Exempel:
  // 91: "Defender",
  // 92: "Defender 1983-2006",
  // 93: "Defender 2007-2016",
  // 94: "Defender 2020-",
  // 80: "Discovery 4",
  // 81: "Discovery 5",
  // 82: "Freelander",
  // 68: "Land Rover",
  // osv...
};

let wooNameMapCache: Map<string, number> | null = null;

async function loadWooCategoryNameMap(): Promise<Map<string, number>> {
  if (wooNameMapCache) return wooNameMapCache;
  const out = new Map<string, number>();
  let page = 1;
  while (true) {
    const arr = await wcGetJSON<any[]>(`/products/categories?per_page=100&page=${page}`);
    const list = Array.isArray(arr) ? arr : [];
    if (!list.length) break;
    for (const c of list) {
      if (typeof c?.id === "number" && typeof c?.name === "string") {
        out.set(c.name.trim().toLowerCase(), c.id);
      }
    }
    if (list.length < 100) break;
    page++;
  }
  wooNameMapCache = out;
  return out;
}

async function wcCatsFromBritpartCategoryIds(categoryIds?: number[]): Promise<{ id: number }[] | undefined> {
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) return undefined;

  const byName = await loadWooCategoryNameMap();
  const set = new Set<number>();

  for (const cid of categoryIds) {
    // 1) direkt ID
    const direct = BRITPART_TO_WC[cid];
    if (typeof direct === "number" && direct > 0) { set.add(direct); continue; }

    // 2) via namn
    const wantName = BRITPART_TO_WC_NAMES[cid];
    if (wantName) {
      const id = byName.get(wantName.trim().toLowerCase());
      if (id) { set.add(id); continue; }
    }

    // 3) fallback – om Woo-kategori råkar heta "46" etc.
    const byNumberName = byName.get(String(cid).toLowerCase());
    if (byNumberName) { set.add(byNumberName); continue; }
  }

  return set.size ? Array.from(set).map((id) => ({ id })) : undefined;
}

/* --------------------------------------------------------------- */
/* Batch helpers (med fallback per item)                           */
/* --------------------------------------------------------------- */

async function createProductsSafe(items: any[], ctx: InvocationContext) {
  let created = 0;
  const idsBySku: Record<string, number> = {};
  const failedSkus: string[] = [];

  for (let i = 0; i < items.length; i += 40) {
    const chunk = items.slice(i, i + 40);
    try {
      const res = await wcPostJSON<{ create?: Array<{ id: number; sku?: string }> }>(
        `/products/batch`,
        { create: chunk }
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
      const res = await wcPostJSON<{ update?: Array<{ id: number }> }>(`/products/batch`, { update: chunk });
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

/* --------------------------------------------------------------- */
/* Types                                                           */
/* --------------------------------------------------------------- */

type ImportRunBody = {
  ids: number[];
  pageSize?: number;
  /** importera endast från dessa leaf-ID (valda i UI) */
  leafIds?: number[];
  /** valfritt: begränsa till exakt dessa SKU */
  restrictSkus?: string[];
  roundingMode?: "none" | "nearest" | "up" | "down";
  roundTo?: number;
};

/* --------------------------------------------------------------- */
/* Azure Function: POST /api/import-run                            */
/* --------------------------------------------------------------- */

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

      // Rimlig chunk-storlek för att inte slå i tidsgränser
      const PAGE_MAX = 50;
      const pageSize = Math.max(1, Math.min(Number(body?.pageSize || 25), PAGE_MAX));

      /* 1) Samla alla SKU (unika) */
      where = "collect-skus";
      let allSkus = Array.from(
        new Set((await britpartGetPartCodesForCategoriesFiltered(ids, body.leafIds)).map(String))
      );
      if (Array.isArray(body.restrictSkus) && body.restrictSkus.length) {
        const allow = new Set(body.restrictSkus.map(String));
        allSkus = allSkus.filter((s) => allow.has(s));
      }
      ctx.log?.(`collect-skus: roots=${ids.join(",")} leafs=${(body.leafIds||[]).join(",")||"-"} total=${allSkus.length}`);

      /* 2) Filtrera bort sådant som redan finns i Woo → nästa körning tar "nästa sida" */
      where = "filter-existing";
      const existingAll = new Set<string>();
      {
        let i = 0;
        const conc = 10;
        async function worker() {
          while (i < allSkus.length) {
            const sku = allSkus[i++]!;
            try {
              const id = await wcFindProductIdBySku(sku);
              if (id) existingAll.add(sku);
            } catch (e) {
              ctx.warn?.(`lookup(all) fail ${sku}: ${emsg(e)}`);
            }
          }
        }
        await Promise.all(Array.from({ length: conc }, worker));
      }

      const pendingSkus = allSkus.filter((s) => !existingAll.has(s));
      const skus = pendingSkus.slice(0, pageSize);
      const remainingSkus = Math.max(0, pendingSkus.length - skus.length);

      if (skus.length === 0) {
        return {
          status: 200,
          headers: CORS,
          jsonBody: {
            ok: true,
            where: "nothing-to-do",
            selectedCategoryIds: ids,
            usedLeafIds: body.leafIds ?? [],
            restrictedToSkus: body.restrictSkus?.length ?? 0,
            pageSize,
            processedSkus: 0,
            totalSkus: allSkus.length,
            remainingSkus,
            hasMore: remainingSkus > 0,
            exists: existingAll.size,
            created: 0,
            updatedWithMeta: 0,
            invalidImageUrls: 0,
            createFailedSkus: [],
            updateFailedIds: [],
            sampleSkus: allSkus.slice(0, 10),
          },
        };
      }

      /* 3) Basdata från Britpart */
      where = "fetch-basics";
      const basics = await britpartGetBasicForSkus(skus);
      const imgOkCount = Object.values(basics).filter((b) => validImage(b.imageUrl)).length;
      ctx.log?.(`fetch-basics: basics=${Object.keys(basics).length}, validImages=${imgOkCount}`);

      /* 4) Skapa saknade (draft) – sätt bild + meta + (ev.) kategorier */
      where = "create";
      const createPayloads: any[] = skus.map((sku) => {
        const b = basics[sku] || {};
        const c = canon(b.imageUrl);
        const meta = [];
        if (b.imageUrl) meta.push({ key: "_lr_source_image_url", value: b.imageUrl });
        if (c) meta.push({ key: "_lr_source_image_canon", value: c });
        if ((b as any).imageSource) meta.push({ key: "_lr_source", value: (b as any).imageSource });
        if (Array.isArray(b.categoryIds)) meta.push({ key: "_lr_britpart_categories", value: JSON.stringify(b.categoryIds) });

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

        // Kategorier: mappa via ID/namn (se ovan)
        (payload as any).categories = undefined; // default
        if (Array.isArray(b.categoryIds) && b.categoryIds.length) {
          // vikt: många delar har flera Britpart-kategorier
          // vi mappar dem alla och låter Woo hantera hierarkin
          // (wcCatsFromBritpartCategoryIds hanterar cache och fallback)
          // Obs: funktionen är async → vi sätter categories nedan i batch
        }

        return payload;
      });

      // Hämta och sätt kategorier (async för alla basics)
      const allCats = await Promise.all(
        skus.map(async (sku) => {
          const b = basics[sku] || {};
          return Array.isArray(b.categoryIds) ? await wcCatsFromBritpartCategoryIds(b.categoryIds) : undefined;
        })
      );
      for (let i = 0; i < createPayloads.length; i++) {
        if (allCats[i]?.length) (createPayloads[i] as any).categories = allCats[i];
      }

      const { created, idsBySku, failedSkus } = await createProductsSafe(createPayloads, ctx);
      ctx.log?.(`create: tried=${skus.length}, created=${created}, failed=${failedSkus.length}`);

      /* 5) (valfri uppdateringspass – avstår i detta flöde) */
      where = "update";
      const updates: WooUpdate[] = [];
      let invalidImageUrls = 0;
      const { updated, failedIds } = await updateProductsSafe(updates, ctx);

      /* 6) Svar */
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
          invalidImageUrls,
          createFailedSkus: failedSkus,
          updateFailedIds: failedIds,
          sampleSkus: skus.slice(0, 10),
        },
      };
    } catch (e: any) {
      const msg = emsg(e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: msg } };
    }
  },
});
