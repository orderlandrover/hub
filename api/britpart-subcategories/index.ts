import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetCategories } from "../shared/britpart";

app.http("britpart-subcategories", {
  route: "britpart-subcategories",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const res = await britpartGetCategories(3);
      const data = await res.json();
      const items = data.subcategories || [];
      return { status: 200, jsonBody: items };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "britpart-subcategories failed" } };
    }
  }
});