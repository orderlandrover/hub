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
  WooCreate,
  WooUpdate,
} from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));
const isHttpUrl = (s?: string) => typeof s === "string" && /^https?:\/\//i.test(s || "");
/** Godkänn alla http(s)-bilder (Woo sideloadar ändå) */
const validImage = (url?: string) => isHttpUrl(url);

/** Skapa i små chunkar. Vid fel: gå ner till per-produkt så resten inte drabbas. */
async function createProductsSafe(items: WooCreate[], ctx: InvocationContext) {
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
      // Fallback: per produkt – och vid SKU-krock hämtar vi ID för att undvika dubblett
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

/** Uppdatera i chunkar; vid fel faller vi ner till per-produkt. */
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

      // 1) Samla SKU (unika)
      where = "collect-skus";
      const partCodes = await britpartGetPartCodesForCategories(ids);
      const skus = Array.from(new Set(partCodes.map(String)));
      ctx.log?.(`collect-skus: ${skus.length}`);

      // 2) Hämta titel/bild/beskrivning för alla SKU (GetAll-first i shared/britpart.ts)
      where = "fetch-basics";
      const basics = await britpartGetBasicForSkus(skus);
      const imgOkCount = Object.values(basics).filter((b) => validImage(b.imageUrl)).length;
      ctx.log?.(`fetch-basics: basics=${Object.keys(basics).length}, validImages=${imgOkCount}`);

      // 3) Vilka finns redan i Woo?
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

      // 4) Skapa saknade (draft, med bild/namn/beskrivning om vi har data)
      where = "create";
      const toCreateSkus = skus.filter((s) => !existing.has(s));
      const createPayloads: WooCreate[] = toCreateSkus.map((sku) => {
        const b = basics[sku] || {};
        const meta = [];
        if (b.imageUrl) meta.push({ key: "_lr_source_image_url", value: b.imageUrl });
        if (b["imageSource"]) meta.push({ key: "_lr_source", value: b["imageSource"] });

        return {
          name: (b.title && b.title.trim()) || sku,
          sku,
          type: "simple",
          status: "draft",
          description: b.description,
          short_description: b.description,
          images: validImage(b.imageUrl) ? [{ src: b.imageUrl!, position: 0 }] : undefined,
          meta_data: meta.length ? meta : undefined,
        };
      });
      const { created, idsBySku, failedSkus } = await createProductsSafe(createPayloads, ctx);
      ctx.log?.(`create: requested=${toCreateSkus.length}, created=${created}, failed=${failedSkus.length}`);

      // 5) Uppdatera namn/bild/beskrivning på alla (befintliga + nyskapade)
      where = "update";
      const updates: WooUpdate[] = [];
      let invalidImageUrls = 0;

      for (const sku of skus) {
        const id = existing.get(sku) ?? idsBySku[sku];
        if (!id) continue;

        const b = basics[sku];
        if (!b) continue;

        const u: WooUpdate = { id };
        if (b.title) u.name = b.title;
        if (b.description) {
          u.description = b.description;
          u.short_description = b.description;
        }

        if (validImage(b.imageUrl)) {
          u.images = [{ src: b.imageUrl!, position: 0 }];
        } else if (b.imageUrl) {
          invalidImageUrls++;
        }

        const meta = [];
        if (b.imageUrl) meta.push({ key: "_lr_source_image_url", value: b.imageUrl });
        if ((b as any).imageSource) meta.push({ key: "_lr_source", value: (b as any).imageSource });
        if (meta.length) (u as any).meta_data = meta;

        if (u.name || u.images || u.description || u.short_description || (u as any).meta_data) {
          updates.push(u);
        }
      }

      const { updated, failedIds } = await updateProductsSafe(updates, ctx);
      ctx.log?.(`update: candidates=${updates.length}, updated=${updated}, failed=${failedIds.length}`);

      // 6) Svar
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
