import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

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

      // Kör batch när det går, annars per ID (här per ID för enkelhet)
      for (const id of body.ids) {
        await wcRequest(`/products/${id}?force=true`, { method: "DELETE" });
      }

      return { jsonBody: { ok: true, count: body.ids.length } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
