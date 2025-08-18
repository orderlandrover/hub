import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

function chunk<T>(arr: T[], size = 100) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

app.http("products-delete", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { ids: number[] };
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return { status: 400, jsonBody: { error: "ids required" } };
      }

      let deleted = 0;
      for (const part of chunk(body.ids, 100)) {
        // WooCommerce batch delete
        const res = await wcRequest(`/products/batch?force=true`, {
          method: "POST",
          body: JSON.stringify({ delete: part }),
        });
        const json = await res.json();
        deleted += (json?.delete?.length ?? part.length);
      }

      return { jsonBody: { ok: true, deleted } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
