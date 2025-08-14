import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
// import { wcRequest } from "../shared/wc";

app.http("import-run", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[] };
      const { subcategoryIds = [] } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      const jobId = `job_${Date.now()}`;
      // TODO: hämta produkter → upsert i WC (POST om ny SKU, annars PUT/PATCH). Batcha och logga.

      return { jsonBody: { ok: true, jobId } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});