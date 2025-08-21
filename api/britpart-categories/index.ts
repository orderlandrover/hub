// api/britpart-categories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetCategories } from "../shared/britpart";

app.http("britpart-categories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv("BRITPART_BASE", "BRITPART_TOKEN");
      const data = await britpartGetCategories();
      return { jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});