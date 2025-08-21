import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

app.http("wc-categories", {
  route: "wc-categories",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const perPage = url.searchParams.get("per_page") || "100";
      const page = url.searchParams.get("page") || "1";

      const res = await wcFetch(`/products/categories?per_page=${perPage}&page=${page}`);
      const items = await res.json();

      return { status: 200, jsonBody: items };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "wc-categories failed" } };
    }
  }
});