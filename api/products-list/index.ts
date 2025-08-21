import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

app.http("products-list", {
  route: "products-list",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const page = url.searchParams.get("page") || "1";
      const perPage = url.searchParams.get("per_page") || "20";

      const res = await wcFetch(`/products?page=${page}&per_page=${perPage}`);
      const items = await res.json();

      return { status: 200, jsonBody: items };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "products-list failed" } };
    }
  }
});