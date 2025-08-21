// api/britpart-getall/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetAll } from "../shared/britpart";

app.http("britpart-getall", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv("BRITPART_BASE", "BRITPART_TOKEN");
      const url = new URL(req.url);
      // Skicka vidare exakt samma query (så du kan använda de parameternamn deras docs säger)
      const data = await britpartGetAll(url.search);
      return { jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});