import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
// import { britpart } from "../shared/britpart";
// import { wcRequest } from "../shared/wc";
// import { toWCProduct } from "../shared/map";

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[]; categoryMap?: Record<string, number> };
      const { subcategoryIds = [] } = body || {};
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      // TODO: hämta produkter från Britpart per subcategoryId, mappa till WC, jämför mot befintliga i WC (via SKU)
      // Returnera lista över create / update / skip.

      return {
        jsonBody: {
          create: [],
          update: [],
          skip: [],
          summary: { create: 0, update: 0, skip: 0 }
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});