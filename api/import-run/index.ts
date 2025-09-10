// api/import-run/index.ts
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
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return null;
  }
};

/* Små helpers */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));

/* --------------------------------------------------------------- */
/* Britpart→Woo kategori-mappning                                  */
/* --------------------------------------------------------------- */
/**
 * Fyll på denna med dina riktiga Woo-kategori-IDn.
 * Key = Britpart categoryId (leaf eller ej), value = Woo categoryId.
 * Exempel: { 58: 123, 57: 124 }
 */
const BRITPART_TO_WC: Record<number, number> = {
  // 58: 123,
  // 57: 124,
};

function wcCatsFromBritpartCategoryIds(categoryIds?: number[]): { id: number }[] | undefined {
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) return undefined;
  const mapped = Array.from(
    new Set(
      categoryIds
        .map((cid) => BRITPART_TO_WC[cid])
        .filter((n): n is number => typeof n === "number" && n > 0)
    )
  );
  return mapped.length ? mapped.map((id) => ({ id })) : undefined;
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
            try {
              const id = await wcFindProductIdBySku(p.sku);
              if (id) {
                idsBySku[p.sku] = id;
                continue;
              }
            } catch (eee) {
              // swallow
            }
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
        try {
          await wcPutJSON(`/products/${u.id}`, u);
          updated++;
        } catch (ee: any) {
          failedIds.push(u.id);
          ctx.warn?.(`Update fail id=${u.id}: ${emsg(ee)}`);
        }
      }
    }
  }
  return { updated, failedIds };
}

/* --------------------------------------------------------------- */
/* Existence lookup                                                */
/* --------------------------------------------------------------- */

/** Kolla mot Woo vilka av skus som redan finns – parallellt men snällt */
async function findExistingIdsForSkus(skus: string[], ctx: InvocationContext, conc = 12) {
  const existing = new Map<string, number>();
  let i = 0;

  async function worker() {
    while (i < skus.length) {
      const sku = skus[i++];
      try {
        const id = await wcFindProductIdBySku(sku);
        if (id) existing.set(sku, id);
      } catch (e) {
        ctx.warn?.(`lookup fail ${sku}: ${emsg(e)}`);
        await sleep(50);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, skus.length)) }, worker));
  return existing;
}

/* --------------------------------------------------------------- */
/* Types                                                           */
/* --------------------------------------------------------------- */

type ImportRunBody = {
  ids: number[];
  pageSize?: number;
  /** valfritt: importera endast från dessa leaf-ID (från probet) */
  leafIds?: number[];
  /** valfritt: begränsa till exakt dessa SKU (kommaseparerat i UI → array här) */
  restrictSkus?: string[];
  /** valfritt: avrundning (pass-through) */
  roundingMode?: "none" | "nearest" | "up" | "down";
  roundTo?: number;
  /** valfritt: även uppdatera existerande (default false = endast pending) */
  includeExisting?: boolean;
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

      // Små, stabila batchar (default 25, max 50 för att undvika 500/timeout)
      const PAGE_MAX = 50;
      const pageSize = Math.max(1, Math.min(Number(body?.pageSize || 25), PAGE_MAX));
      const includeExisting = !!body?.includeExisting;

      /* 1) Samla ALLA unika SKU under valda rötter (+ ev. leaf-filter + restrictSkus) */
      where = "collect-skus";
      let allSkus = uniq(
        (await britpartGetPartCodesForCategoriesFiltered(ids, body.leafIds)).map(String)
      );

      if (Array.isArray(body.restrictSkus) && body.restrictSkus.length) {
        const allow = new Set(body.restrictSkus.map((s) => String(s)));
        allSkus = allSkus.filter((s) => allow.has(s));
      }

      /* 2) Hitta vad som redan finns i Woo (GLOBALT) → räkna fram pending */
      where = "lookup-existing-all";
      const existingAll = await findExistingIdsForSkus(allSkus, ctx, 12);
      const pendingSkus = allSkus.filter((s) => !existingAll.has(s));

      // Vilka SKU ska vi faktiskt jobba på i denna körning?
      // - Pending först
      // - Om includeExisting=true och pending < pageSize => fyll på med existerande (för “refresh”)
      const batchPending = pendingSkus.slice(0, pageSize);
      let batchSkus = batchPending;

      if (includeExisting && batchSkus.length < pageSize) {
        const stillNeed = pageSize - batchSkus.length;
        const extras = allSkus
          .filter((s) => existingAll.has(s))
          .slice(0, stillNeed);
        batchSkus = batchSkus.concat(extras);
      }

      const remainingSkus = Math.max(0, pendingSkus.length - batchPending.length);

      ctx.log?.(
        `roots=${ids.join(",")} leafs=${(body.leafIds || []).join(",") || "-"} total=${allSkus.length} existed=${existingAll.size} pending=${pendingSkus.length} take=${batchSkus.length} remaining=${remainingSkus} includeExisting=${includeExisting}`
      );

      if (batchSkus.length === 0) {
        return {
          status: 200,
          headers: CORS,
          jsonBody: {
            ok: true,
            where: "empty",
            selectedCategoryIds: ids,
            usedLeafIds: body.leafIds ?? [],
            restrictedToSkus: body.restrictSkus?.length ?? 0,
            pageSize,
            processedSkus: 0,
            totalSkus: allSkus.length,
            existingBefore: existingAll.size,
            pendingBefore: pendingSkus.length,
            remainingSkus,
            hasMore: remainingSkus > 0,
            exists: 0,
            created: 0,
            updatedWithMeta: 0,
            invalidImageUrls: 0,
            createFailedSkus: [],
            updateFailedIds: [],
            sampleSkus: [],
          },
        };
      }

      /* 3) Hämta basdata från Britpart för batchen */
      where = "fetch-basics";
      const basics = await britpartGetBasicForSkus(batchSkus);
      const imgOkCount = Object.values(basics).filter((b) => validImage(b.imageUrl)).length;
      ctx.log?.(`fetch-basics: basics=${Object.keys(basics).length}, validImages=${imgOkCount}`);

      /* 4) Finns redan i Woo i DENNA batch? (race-skydd) */
      where = "lookup-existing-batch";
      const existingBatch = await findExistingIdsForSkus(batchSkus, ctx, 8);

      /* 5) Skapa saknade (draft) – sätt bild + meta + (ev.) kategorier */
      where = "create";
      const toCreateSkus = batchSkus.filter((s) => !existingBatch.has(s));
      const createPayloads: any[] = toCreateSkus.map((sku) => {
        const b = basics[sku] || {};
        const c = canon(b.imageUrl);
        const meta = [];
        if (b.imageUrl) meta.push({ key: "_lr_source_image_url", value: b.imageUrl });
        if (c) meta.push({ key: "_lr_source_image_canon", value: c });
        if ((b as any).imageSource) meta.push({ key: "_lr_source", value: (b as any).imageSource });
        if (Array.isArray(b.categoryIds))
          meta.push({ key: "_lr_britpart_categories", value: JSON.stringify(b.categoryIds) });

        const cats = wcCatsFromBritpartCategoryIds((b as any).categoryIds);

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
      ctx.log?.(`create: requested=${toCreateSkus.length}, created=${created}, failed=${failedSkus.length}`);

      /* 6) Läs befintlig canon-meta för existerande produkter (för att undvika resideload) */
      where = "prefetch-existing-meta";
      const existingIdsForMeta = uniq([
        ...Array.from(existingBatch.values()),
        ...Object.values(idsBySku), // kan vara tom om inget skapades
      ]);
      const existingMetaById = new Map<number, { canon?: string }>();
      {
        let i = 0;
        const conc = 8;
        async function worker() {
          while (i < existingIdsForMeta.length) {
            const pid = existingIdsForMeta[i++];
            try {
              const prod = await wcGetJSON<any>(`/products/${pid}?_fields=id,meta_data`);
              const meta = Array.isArray(prod?.meta_data) ? prod.meta_data : [];
              const canonMeta = meta.find((m: any) => m?.key === "_lr_source_image_canon")?.value;
              existingMetaById.set(pid, { canon: typeof canonMeta === "string" ? canonMeta : undefined });
            } catch {
              // ignore
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, existingIdsForMeta.length)) }, worker));
      }

      /* 7) Uppdatera (namn/bild/desc/kategorier) för existerande eller skapade nyss */
      where = "update";
      const updates: WooUpdate[] = [];
      let invalidImageUrls = 0;

      for (const sku of batchSkus) {
        const idExisting = existingBatch.get(sku);
        const idCreated = idsBySku[sku];
        const id = idExisting ?? idCreated;
        if (!id) continue;

        const b = (basics as any)[sku];
        if (!b) continue;

        const wasCreatedNow = !!idCreated && !idExisting;
        const u: WooUpdate = { id };

        // Namn/beskrivning – bra även för existerande, men onödigt direkt efter create
        if (!wasCreatedNow) {
          if (b.title) u.name = b.title;
          if (b.description) {
            u.description = b.description;
            u.short_description = b.description;
          }
        }

        // Bild – undvik resideload om canon inte ändrats
        if (!wasCreatedNow) {
          const newCanon = canon(b.imageUrl);
          const prevCanon = existingMetaById.get(id)?.canon;

          if (validImage(b.imageUrl) && newCanon && newCanon !== prevCanon) {
            u.images = [{ src: b.imageUrl!, position: 0 }];
            (u as any).meta_data = [
              { key: "_lr_source_image_url", value: b.imageUrl },
              { key: "_lr_source_image_canon", value: newCanon },
              ...(b as any).imageSource ? [{ key: "_lr_source", value: (b as any).imageSource }] : [],
              Array.isArray(b.categoryIds)
                ? { key: "_lr_britpart_categories", value: JSON.stringify(b.categoryIds) }
                : null,
            ].filter(Boolean);
          } else if (b.imageUrl && !newCanon) {
            invalidImageUrls++;
          }
        }

        // Kategorier – sätts även på existerande om mappning finns (och inte skapad just nu)
        const cats = wcCatsFromBritpartCategoryIds(b.categoryIds);
        if (!wasCreatedNow && cats) {
          (u as any).categories = cats;
          (u as any).meta_data = [
            ...(((u as any).meta_data as any[]) ?? []),
            { key: "_lr_britpart_categories", value: JSON.stringify(b.categoryIds) },
          ];
        }

        if (
          u.name ||
          u.images ||
          u.description ||
          u.short_description ||
          (u as any).categories ||
          (u as any).meta_data
        ) {
          updates.push(u);
        }
      }

      const { updated, failedIds } = await updateProductsSafe(updates, ctx);
      ctx.log?.(`update: candidates=${updates.length}, updated=${updated}, failed=${failedIds.length}`);

      /* 8) Svar (med pagination-info) */
      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          where: "done",
          selectedCategoryIds: ids,
          usedLeafIds: body.leafIds ?? [],
          restrictedToSkus: body.restrictSkus?.length ?? 0,
          includeExisting,
          pageSize,
          processedSkus: batchSkus.length,
          totalSkus: allSkus.length,
          existingBefore: existingAll.size,
          pendingBefore: pendingSkus.length,
          remainingSkus,
          hasMore: remainingSkus > 0,
          exists: existingBatch.size,
          created,
          updatedWithMeta: updated,
          invalidImageUrls,
          createFailedSkus: failedSkus,
          updateFailedIds: failedIds,
          sampleSkus: batchSkus.slice(0, 10),
        },
      };
    } catch (e: any) {
      const msg = emsg(e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: msg } };
    }
  },
});
