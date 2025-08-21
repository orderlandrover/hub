import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetAll } from "../shared/britpart";

app.http("britpart-getall", {
  route: "britpart-getall",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const u = new URL(req.url);
      const page = Number(u.searchParams.get("page") || 1);
      const code = u.searchParams.get("code") || undefined;
      const modifiedSince = u.searchParams.get("modifiedSince") || undefined;
      const tokenOverride = u.searchParams.get("token") || undefined;

      const data = await britpartGetAll({ page, code, modifiedSince }, tokenOverride);

      return {
        status: 200,
        jsonBody: data,
        headers: { "Access-Control-Allow-Origin": "*" }
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "britpart-getall failed" } };
    }
  }
});