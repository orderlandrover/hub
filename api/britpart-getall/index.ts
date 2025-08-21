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
      const subcategoryId = url.searchParams.get("subcategoryId") || undefined;
      const page = Number(url.searchParams.get("page") || "1");
      const data = await britpartGetAll({ subcategoryId, page });
      return { jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});