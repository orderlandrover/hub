// api/import-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  britpartGetPartCodesForCategories,
  britpartGetBasicForSkus,
} from "../shared/britpart";
import {
  wcFindProductIdBySku,
  wcPostJSON,
  wcPutJSON,
  wcGetJSON,
  WooCreate,
  WooUpdate,
} from "../shared/wc";

/* --------------------------------------------------------------- */
/* CORS + utils                                                     */
/* --------------------------------------------------------------- */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));
const isHttpUrl = (s?: string) => typeof s === "string" && /^https?:\/\//i.test(s || "");
/** Godkänn alla http(s)-bilder – Woo sideloadar ändå till medialibrary */
const validImage = (url?: string) => isHttpUrl(url);

/** Kanonisk bild-URL (utan query) för att undvika onödig “resideload” */
const canon = (u?: string) => {
  if (!u) return null;
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return null;
  }
};

/* --------------------------------------------------------------- */
/* Batch helpers (med fallback per item)                           */
/* --------------------------------------------------------------- */

/** Skapa i chunkar; vid fel: fallback per produkt, och hantera SKU-krock */
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
      for (const c of arr) {
        if (c?.id && c?.sku) idsBySku[c.sku] = Number(c.id);
      }
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
          // Woo säger att SKU finns → hämta ID och fortsätt
          if (/sku/i.test(text) && /exist/i.test(text)) {
            const id = await wcFindProductIdBySku(p.sku);
            if (id) {
              idsBySku[p.sku] = id;
              continue;
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

/** Uppdatera i chunkar; vid fel: fallback per produkt */
async function updateProductsSafe(updates: WooUpdate[], ctx: InvocationContext) {
  let updated = 0;
  const failedIds: number[] = [];

  for (let i = 0; i < updates.length; i += 80) {
    const chunk = updates.slice(i, i + 80);
    try {
      const res = await wcPostJSON<{ update?: Array<{ id: number }> }>(`/products/batch`, {
        update: chunk,
      });
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
/* Azure Function: POST /api/import-run                             */
/* --------------------------------------------------------------- */

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    let where = "start";
    try {
      const { ids } = (await req.json()) as { ids: number[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No ids" } };
      }

      /* 1) Samla SKU (unika) */
      where = "collect-skus";
      const partCodes = await britpartGetPartCodesForCategories(ids);
      const skus = Array.from(new Set(partCodes.map(String)));
      ctx.log?.(`collect-skus: ${skus.length}`);

      /* 2) Basdata från Britpart (GetAll först, fallback i shared/britpart) */
      where = "fetch-basics";
      const basics = await britpartGetBasicForSkus(skus);
      const imgOkCount = Object.values(basics).filter((b) => validImage(b.imageUrl)).length;
      ctx.log?.(`fetch-basics: basics=${Object.keys(basics).length}, validImages=${imgOkCount}`);

      /* 3) Vilka produkter finns redan i Woo? */
      where = "lookup-existing";
      const existing = new Map<string, number>();
      {
        let i = 0;
        const conc = 10;
        async function worker() {
          while (i < skus.length) {
            const idx = i++;
            const sku = skus[idx];
            try {
              const id = await wcFindProductIdBySku(sku);
              if (id) existing.set(sku, id);
            } catch (e) {
              ctx.warn?.(`lookup fail ${sku}: ${emsg(e)}`);
            }
          }
        }
        await Promise.all(Array.from({ length: conc }, worker));
      }
      ctx.log?.(`lookup-existing: exists=${existing.size}`);

      /* 4) Skapa saknade (draft) – med bild/namn/beskrivning + meta om vi har det */
      where = "create";
      const toCreateSkus = skus.filter((s) => !existing.has(s));

      const createPayloads: any[] = toCreateSkus.map((sku) => {
        const b = basics[sku] || {};
        const c = canon(b.imageUrl);
        const meta = [];
        if (b.imageUrl) meta.push({ key: "_lr_source_image_url", value: b.imageUrl });
        if (c) meta.push({ key: "_lr_source_image_canon", value: c });
        if ((b as any).imageSource) meta.push({ key: "_lr_source", value: (b as any).imageSource });

        const payload: any = {
          name: (b.title && b.title.trim()) || sku,
          sku,
          type: "simple",
          status: "draft",
          description: b.description,
          short_description: b.description,
          meta_data: meta.length ? meta : undefined,
        };

        if (validImage(b.imageUrl)) {
          payload.images = [{ src: b.imageUrl, position: 0 }];
        }

        return payload;
      });

      const { created, idsBySku, failedSkus } = await createProductsSafe(createPayloads, ctx);
      ctx.log?.(`create: requested=${toCreateSkus.length}, created=${created}, failed=${failedSkus.length}`);

      /* 4.5) Läs befintlig canon-meta för existerande produkter (för att undvika “resideload”) */
      where = "prefetch-existing-meta";
      const existingById: number[] = [];
      for (const sku of skus) {
        const id = existing.get(sku);
        if (id) existingById.push(id);
      }

      const existingMetaById = new Map<number, { canon?: string }>();
      {
        let i = 0;
        const conc = 8;
        async function worker() {
          while (i < existingById.length) {
            const idx = i++;
            const pid = existingById[idx];
            try {
              const prod = await wcGetJSON<any>(`/products/${pid}?_fields=id,meta_data`);
              const meta = Array.isArray(prod?.meta_data) ? prod.meta_data : [];
              const canonMeta = meta.find((m: any) => m?.key === "_lr_source_image_canon")?.value;
              existingMetaById.set(pid, { canon: typeof canonMeta === "string" ? canonMeta : undefined });
            } catch {
              // ignorerar enstaka fel
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, existingById.length)) }, worker));
      }

      /* 5) Uppdatera namn/bild/beskrivning på redan existerande produkter
            (hoppa över de som skapades nyss för att undvika dubbla sideloads) */
      where = "update";
      const updates: WooUpdate[] = [];
      let invalidImageUrls = 0;

      for (const sku of skus) {
        const idExisting = existing.get(sku);
        const idCreated = idsBySku[sku];
        const id = idExisting ?? idCreated;
        if (!id) continue;

        const b = basics[sku];
        if (!b) continue;

        // Skippa uppdatering för de som skapades i samma körning (vi satte redan allt i create)
        const wasCreatedNow = !!idCreated && !idExisting;
        const u: WooUpdate = { id };

        // Namn/description kan vi uppdatera även på existerande
        if (!wasCreatedNow) {
          if (b.title) u.name = b.title;
          if (b.description) {
            u.description = b.description;
            u.short_description = b.description;
          }
        }

        // Bildlogik – endast för existerande (eller om create saknade bild)
        if (!wasCreatedNow) {
          const newCanon = canon(b.imageUrl);
          const prevCanon = existingMetaById.get(id)?.canon;

          if (validImage(b.imageUrl) && newCanon && newCanon !== prevCanon) {
            u.images = [{ src: b.imageUrl!, position: 0 }];
            (u as any).meta_data = [
              { key: "_lr_source_image_url", value: b.imageUrl },
              { key: "_lr_source_image_canon", value: newCanon },
              ...(b as any).imageSource ? [{ key: "_lr_source", value: (b as any).imageSource }] : [],
            ];
          } else if (b.imageUrl && !newCanon) {
            invalidImageUrls++;
          }
        }

        if (
          u.name ||
          u.images ||
          u.description ||
          u.short_description ||
          (u as any).meta_data
        ) {
          updates.push(u);
        }
      }

      const { updated, failedIds } = await updateProductsSafe(updates, ctx);
      ctx.log?.(`update: candidates=${updates.length}, updated=${updated}, failed=${failedIds.length}`);

      /* 6) Svar */
      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          where: "done",
          selectedCategoryIds: ids,
          totalSkus: skus.length,
          exists: existing.size,
          created,
          updatedWithMeta: updated,
          invalidImageUrls,
          createFailedSkus: failedSkus,
          updateFailedIds: failedIds,
          sampleSkus: skus.slice(0, 10),
        },
      };
    } catch (e: any) {
      ctx.error?.(e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: emsg(e) } };
    }
  },
});
