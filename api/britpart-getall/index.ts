import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetAll } from "../shared/britpart";

app.http("britpart-getall", {
  route: "britpart-getall",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const page = Number(url.searchParams.get("page") || 1);
      const subcategoryId = url.searchParams.get("subcategoryId")
        ? Number(url.searchParams.get("subcategoryId"))
        : undefined;

      const res = await britpartGetAll({ page, subcategoryId });
      const data = await res.json();
      return { status: 200, jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "britpart-getall failed" } };
    }
  }
});