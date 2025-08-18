// api/products-delete/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

/**
 * Tar emot: { ids: number[] }
 * Raderar i WooCommerce. Vi försöker först batch-endpoint, annars faller vi
 * tillbaka till individuella DELETE-anrop med ?force=true.
 */
app.http("products-delete", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      const body = await req.json().catch(() => ({}));
      const ids: number[] = Array.isArray(body?.ids) ? body.ids : [];
      if (!ids.length) {
        return { status: 400, jsonBody: { error: "ids required" } };
      }

      // Försök batcha (snabbast)
      try {
        const batch = {
          delete: ids.map((id) => ({ id })), // Woo batch tar objekt { id }
        };
        const res = await wcRequest(`/products/batch?force=true`, {
          method: "POST",
          body: JSON.stringify(batch),
        });
        const json = await res.json();
        const deleted: number[] = (json?.delete || []).map((p: any) => p?.id).filter(Boolean);
        const failed = ids.filter((id) => !deleted.includes(id));
        return { jsonBody: { ok: failed.length === 0, deleted, failed } };
      } catch (err) {
        // Fallback: radera en och en (mer kompatibelt men långsammare)
        const ok: number[] = [];
        const failed: Array<{ id: number; error: string }> = [];
        // Kör i små batchar för att inte strypas
        const chunk = async (arr: number[], size = 10) => {
          for (let i = 0; i < arr.length; i += size) {
            const part = arr.slice(i, i + size);
            await Promise.all(
              part.map(async (id) => {
                try {
                  const res = await wcRequest(`/products/${id}?force=true`, { method: "DELETE" });
                  const j = await res.json();
                  ok.push(j?.id ?? id);
                } catch (e: any) {
                  failed.push({ id, error: e?.message || "delete failed" });
                }
              })
            );
          }
        };
        await chunk(ids, 10);
        return { jsonBody: { ok: failed.length === 0, deleted: ok, failed } };
      }
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "internal error" } };
    }
  },
});
