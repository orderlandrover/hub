import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";
import { britpartGetAll } from "../shared/britpart";

function pickSKU(it: any): string {
  return (
    it?.partNumber || it?.partNo || it?.PartNo || it?.["Part No"] ||
    it?.sku || it?.code || ""
  ).toString().trim();
}
function pickName(it: any): string {
  return (it?.description || it?.Description || it?.["Description"] || pickSKU(it)).toString().trim();
}

async function getWCBySku(sku: string) {
  const r = await wcRequest(`/products?sku=${encodeURIComponent(sku)}`);
  const arr = await r.json();
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

app.http("import-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[]; publish?: boolean; limitPerSub?: number };
      const { subcategoryIds = [], publish = false, limitPerSub = 3 } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      const created: any[] = [];
      const updated: any[] = [];
      const errors: Array<{ sku: string; error: string }> = [];

      for (const sub of subcategoryIds) {
        // Hämta FÅ för test just nu
        const r = await britpartGetAll({ subcategory: sub, top: limitPerSub });
        const j = await r.json();
        const items: any[] = Array.isArray(j) ? j : (j.items || j.data || []);

        for (const it of items) {
          const sku = pickSKU(it);
          if (!sku) continue;

          try {
            const existing = await getWCBySku(sku);
            const payload: any = {
              sku,
              name: pickName(it),
              status: publish ? "publish" : "draft",
            };

            if (!existing) {
              const cr = await wcRequest(`/products`, { method: "POST", body: JSON.stringify(payload) });
              const pj = await cr.json();
              created.push({ id: pj.id, sku });
            } else {
              const up = await wcRequest(`/products/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
              const uj = await up.json();
              updated.push({ id: uj.id, sku });
            }
          } catch (e: any) {
            errors.push({ sku, error: e?.message || String(e) });
          }
        }
      }

      return {
        jsonBody: {
          ok: true,
          summary: { created: created.length, updated: updated.length, errors: errors.length },
          sample: { created: created.slice(0, 5), updated: updated.slice(0, 5), errors: errors.slice(0, 5) },
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});