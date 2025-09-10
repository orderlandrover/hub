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
  try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return null; }
};

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
  /** valfritt: importera endast från dessa leaf-ID (från probet) */
  leafIds?: number[];
  /** valfritt: begränsa till exakt dessa SKU (kommaseparerat i UI → array här) */
  restrictSkus?: string[];
  /** valfritt: avrundningsparametrar (sparas ej här – bara passthrough) */
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

      // Kör hellre små stabila batcher – du kan trycka “Importera igen” för att tömma allt.
      const PAGE_MAX = 50;
      const pageSize = Math.max(1, Math.min(Number(body?.pageSize || 25), PAGE_MAX));

      /* 1) Samla ALLA SKU (unika) från rötter + ev. leaf-filter + restrictSkus */
      where = "collect-skus";
      let allSkus = Array.from(
        new Set(
          (await britpartGetPartCodesForCategoriesFiltered(ids, body.leafIds)).map(String)
        )
      );
      if (Array.isArray(body.restrictSkus) && body.restrictSkus.length) {
        const allow = new Set(body.restrictSkus.map(String));
        allSkus = allSkus.filter((s) => allow.has(s));
      }

      /* 2) Kolla mot Woo VILKA AV ALLA som redan finns → pending = resten */
      where = "lookup-existing-all";
      const existingAll = new Map<string, number>();
      {
        let i = 0;
        const conc = 12;
        async function worker() {
          while (i < allSkus.length) {
            const sku = allSkus[i++];
            try {
              const id = await wcFindProductIdBySku(sku);
              if (id) existingAll.set(sku, id);
            } catch (e) {
              ctx.warn?.(`lookup(all) fail ${sku}: ${emsg(e)}`);
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, allSkus.length)) }, worker));
      }

      const pendingSkus = allSkus.filter((s) => !existingAll.has(s));
      const skus = pendingSkus.slice(0, pageSize);
      const remainingSkus = Math.max(0, pendingSkus.length - skus.length);

      ctx.log?.(
        `roots=${ids.join(",")} leafs=${(body.leafIds || []).join(",") || "-"} total=${allSkus.length} existed=${existingAll.size} pending=${pendingSkus.length} take=${skus.length} rem=${remainingSkus}`
      );

      if (skus.length === 0) {
        return {
          status: 200,
          headers: CORS,
          jsonBody: {
            ok: true,
            where: "nothing-to-create",
            selectedCategoryIds: ids,
            usedLeafIds: body.leafIds ?? [],
            restrictedToSkus: body.restrictSkus?.length ?? 0,
            pageSize,
            processedSkus: 0,
            totalSkus: allSkus.length,
            remainingSkus: 0,
            hasMore: false,
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

      /* 3) Basdata från Britpart för just denna batch */
      where = "fetch-basics";
      const basics = await britpartGetBasicForSkus(skus);
      const imgOkCount = Object.values(basics).filter((b) => validImage(b.imageUrl)).length;
      ctx.log?.(`fetch-basics: basics=${Object.keys(basics).length}, validImages=${imgOkCount}`);

      /* 4) (säkerhet) Markera vilka i den här batchen som ev. råkade finnas ändå */
      where = "lookup-existing-batch";
      const existing = new Map<string, number>();
      for (const s of skus) {
        const id = existingAll.get(s);
        if (id) existing.set(s, id);
      }

      /* 5) Skapa saknade (draft) – sätt bild + meta + (ev.) kategorier */
      where = "create";
      const toCreateSkus = skus.filter((s) => !existing.has(s));
      const createPayloads: any[] = toCreateSkus.map((sku) => {
        const b = basics[sku] || {};
        const c = canon(b.imageUrl);
        const meta = [];
        if (b.imageUrl) meta.push({ key: "_lr_source_image_url", value: b.imageUrl });
        if (c) meta.push({ key: "_lr_source_image_canon", value: c });
        if ((b as any).imageSource) meta.push({ key: "_lr_source", value: (b as any).imageSource });
        if (Array.isArray(b.categoryIds)) meta.push({ key: "_lr_britpart_categories", value: JSON.stringify(b.categoryIds) });

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

      /* 6) Läs ev. canon-meta på existerande i batch (för att undvika resideload) */
      where = "prefetch-existing-meta";
      const existingById = Array.from(existing.values());
      const existingMetaById = new Map<number, { canon?: string }>();
      {
        let i = 0;
        const conc = 8;
        async function worker() {
          while (i < existingById.length) {
            const pid = existingById[i++];
            try {
              const prod = await wcGetJSON<any>(`/products/${pid}?_fields=id,meta_data`);
              const meta = Array.isArray(prod?.meta_data) ? prod.meta_data : [];
              const canonMeta = meta.find((m: any) => m?.key === "_lr_source_image_canon")?.value;
              existingMetaById.set(pid, { canon: typeof canonMeta === "string" ? canonMeta : undefined });
            } catch { /* ignore */ }
          }
        }
        await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, existingById.length)) }, worker));
      }

      /* 7) Uppdatera i batch (för de som fanns sedan innan) */
      where = "update";
      const updates: WooUpdate[] = [];
      let invalidImageUrls = 0;

      for (const sku of skus) {
        const idExisting = existing.get(sku);
        const idCreated = idsBySku[sku];
        const id = idExisting ?? idCreated;
        if (!id) continue;

        const b = (basics as any)[sku]; if (!b) continue;
        const wasCreatedNow = !!idCreated && !idExisting;

        const u: WooUpdate = { id };

        if (!wasCreatedNow) {
          if (b.title) u.name = b.title;
          if (b.description) { u.description = b.description; u.short_description = b.description; }
        }

        if (!wasCreatedNow) {
          const newCanon = canon(b.imageUrl);
          const prevCanon = existingMetaById.get(id)?.canon;
          if (validImage(b.imageUrl) && newCanon && newCanon !== prevCanon) {
            u.images = [{ src: b.imageUrl!, position: 0 }];
            (u as any).meta_data = [
              { key: "_lr_source_image_url", value: b.imageUrl },
              { key: "_lr_source_image_canon", value: newCanon },
              ...(b as any).imageSource ? [{ key: "_lr_source", value: (b as any).imageSource }] : [],
              Array.isArray(b.categoryIds) ? { key: "_lr_britpart_categories", value: JSON.stringify(b.categoryIds) } : null,
            ].filter(Boolean);
          } else if (b.imageUrl && !newCanon) {
            invalidImageUrls++;
          }
        }

        const cats = wcCatsFromBritpartCategoryIds(b.categoryIds);
        if (!wasCreatedNow && cats) {
          (u as any).categories = cats;
          (u as any).meta_data = [
            ...(((u as any).meta_data as any[]) ?? []),
            { key: "_lr_britpart_categories", value: JSON.stringify(b.categoryIds) },
          ];
        }

        if (u.name || u.images || u.description || u.short_description || (u as any).categories || (u as any).meta_data) {
          updates.push(u);
        }
      }

      const { updated, failedIds } = await updateProductsSafe(updates, ctx);
      ctx.log?.(`update: candidates=${updates.length}, updated=${updated}, failed=${failedIds.length}`);

      /* 8) Svar */
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
          exists: existingAll.size,  // hur många fanns redan totalt
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
