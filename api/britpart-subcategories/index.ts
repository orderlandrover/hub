import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetCategories } from "../shared/britpart";

app.http("britpart-subcategories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv("BRITPART_BASE", "BRITPART_TOKEN");
      const data = await britpartGetCategories();
      const items = Array.isArray(data?.subcategories)
        ? data.subcategories
            .filter((s: any) => s?.id && s?.title)
            .map((s: any) => ({ id: String(s.id), name: String(s.title) }))
        : [];
      return { jsonBody: { items } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});