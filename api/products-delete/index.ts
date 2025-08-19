import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

type DeleteBody = { ids?: Array<number | string> };

app.http("products-delete", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      // ----- säkert parse + tydlig typ -----
      let body: DeleteBody = {};
      try {
        body = (await req.json()) as DeleteBody;
      } catch {
        body = {};
      }

      const ids = (Array.isArray(body.ids) ? body.ids : [])
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n));

      if (ids.length === 0) {
        return { status: 400, jsonBody: { error: "ids required" } };
      }

      // ----- radera i små batchar, med force=true -----
      const chunkSize = 20;
      const results: Array<{ id: number; ok: boolean; error?: string }> = [];

      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);

        const settled = await Promise.allSettled(
          chunk.map((id) =>
            wcRequest(`/products/${id}?force=true`, { method: "DELETE" }).then((r) => r.json())
          )
        );

        settled.forEach((s, idx) => {
          const id = chunk[idx];
          if (s.status === "fulfilled") {
            results.push({ id, ok: true });
          } else {
            results.push({
              id,
              ok: false,
              error: (s as PromiseRejectedResult).reason?.message || String((s as PromiseRejectedResult).reason),
            });
          }
        });
      }

      const deleted = results.filter((r) => r.ok).length;
      return { status: 200, jsonBody: { ok: true, deleted, results } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});