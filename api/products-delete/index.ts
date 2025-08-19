import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

/**
 * DELETE selected WooCommerce products (force=true, permanent).
 * Route: /api/products-delete   Method: POST
 * Body: { ids: number[] }
 */
app.http("products-delete", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      // Läs JSON tryggt
      const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
      const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(Number).filter(n => Number.isFinite(n)) : [];

      if (ids.length === 0) {
        return { status: 400, jsonBody: { error: "ids required (number[])" } };
      }

      const results: Array<{ id: number; ok: boolean; error?: string }> = [];

      // Kör per-ID (mer kontrollerbart än batch)
      for (const id of ids) {
        try {
          const res = await wcRequest(`/products/${id}?force=true`, { method: "DELETE" });
          // läs men vi bryr oss mest om status
          await res.json().catch(() => ({}));
          results.push({ id, ok: true });
        } catch (e: any) {
          results.push({ id, ok: false, error: String(e?.message || e) });
        }
      }

      const deleted = results.filter(r => r.ok).length;
      return { jsonBody: { ok: deleted === ids.length, deleted, total: ids.length, results } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});