import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("products-delete", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      // Säkert body-parsning
      let body: any = null;
      try { body = await req.json(); } catch { body = null; }

      const ids: number[] = Array.isArray(body?.ids)
        ? body.ids.map((n: any) => Number(n)).filter((n: any) => Number.isFinite(n) && n > 0)
        : [];

      if (ids.length === 0) {
        return { status: 400, jsonBody: { error: "ids required (number[])" } };
      }

      // Kör DELETE mot WooCommerce med force=true
      const results = await Promise.allSettled(
        ids.map((id) =>
          wcRequest(`/products/${id}?force=true`, { method: "DELETE" }).then((r) => r.json())
        )
      );

      const ok = results.filter((r) => r.status === "fulfilled").length;
      const errors = results
        .map((r, i) => (r.status === "rejected" ? { id: ids[i], error: (r as PromiseRejectedResult).reason?.message ?? "unknown" } : null))
        .filter(Boolean);

      return { jsonBody: { ok: true, deleted: ok, failed: errors } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});