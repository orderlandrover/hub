import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

/**
 * products-delete
 * POST { ids: number[] }
 * - raderar produkterna i WooCommerce, force=true
 * GET  – enkel ping så du kan verifiera att routen finns (bra vid felsökning)
 */
app.http("products-delete", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      // Hjälp-ping: öppna /api/products-delete i webbläsaren
      if (req.method === "GET") {
        return { jsonBody: { ok: true, route: "products-delete" } };
      }

      // Säkrare body-parsing (undvik "Unexpected end of JSON input")
      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }

      const ids: number[] = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
      if (ids.length === 0) return { status: 400, jsonBody: { error: "ids required" } };

      let deleted = 0;
      const failed: Array<{ id: number; error: string }> = [];

      for (const id of ids) {
        try {
          await wcRequest(`/products/${id}?force=true`, { method: "DELETE" });
          deleted++;
        } catch (e: any) {
          failed.push({ id, error: e?.message || String(e) });
        }
      }

      return { jsonBody: { ok: failed.length === 0, deleted, failed } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || String(e) } };
    }
  },
});