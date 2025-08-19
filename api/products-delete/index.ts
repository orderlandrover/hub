import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcRequest } from "../shared/wc";
import { assertEnv } from "../shared/env";

function chunk<T>(arr: T[], size = 50): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * POST /api/products-delete
 * Body: { ids: number[] }
 * Uses WooCommerce batch endpoint and force=true for permanent delete.
 */
app.http("products-delete", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }

      const ids: number[] = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
      if (ids.length === 0) {
        return { status: 400, jsonBody: { error: "ids required" } };
      }

      const errors: any[] = [];
      let deleted = 0;

      for (const group of chunk(ids, 100)) {
        try {
          const res = await wcRequest(`/products/batch`, {
            method: "POST",
            body: JSON.stringify({ delete: group, force: true }),
          });
          const j = await res.json();
          deleted += (j?.delete?.length || 0);
          if (Array.isArray(j?.errors) && j.errors.length) errors.push(...j.errors);
        } catch (e: any) {
          errors.push({ group, message: e?.message || String(e) });
        }
      }

      return { jsonBody: { ok: true, deleted, errors } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});