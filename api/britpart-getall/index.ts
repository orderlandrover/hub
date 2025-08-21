import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetAll } from "../shared/britpart";

app.http("britpart-getall", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const u = new URL(req.url);
      const subcategoryId = u.searchParams.get("subcategoryId") || "";
      const page = Number(u.searchParams.get("page") || "1");
      if (!subcategoryId) return { status: 400, jsonBody: { error: "subcategoryId required" } };
      const data = await britpartGetAll(subcategoryId, page);
      return { jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});