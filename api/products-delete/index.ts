import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

/**
 * Delete WooCommerce products by ID.
 * POST /api/products-delete
 * Body: { ids: number[], force?: boolean }  // force=true = delete permanently (default)
 */
app.http("products-delete", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      const body = (await req.json()) as { ids?: number[]; force?: boolean };
      const ids = Array.isArray(body?.ids) ? body!.ids : [];
      const force = body?.force !== false; // default true

      if (ids.length === 0) {
        return { status: 400, jsonBody: { error: "ids required" } };
      }

      // Simple & reliable: delete one by one (avoids batch quirks)
      // For many items you can later switch to /products/batch { delete: [ids] }
      let deleted = 0;
      const errors: Array<{ id: number; error: string }> = [];

      for (const id of ids) {
        try {
          await wcRequest(`/products/${id}?force=${force ? "true" : "false"}`, { method: "DELETE" });
          deleted++;
        } catch (e: any) {
          errors.push({ id, error: e?.message || String(e) });
        }
      }

      return {
        status: errors.length ? 207 : 200, // 207 = multi-status (some failed)
        jsonBody: { ok: errors.length === 0, requested: ids.length, deleted, errors },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
