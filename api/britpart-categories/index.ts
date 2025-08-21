import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetCategories } from "../shared/britpart";

app.http("britpart-categories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const data = await britpartGetCategories();
      return { jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});