import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

app.http("products-update", {
  route: "products-update/{id}",
  methods: ["PUT"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = req.params["id"];
      if (!id) return { status: 400, jsonBody: { error: "Missing product ID" } };

      const body = await req.json();
      const res = await wcFetch(`/products/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });

      const data = await res.json();
      return { status: res.ok ? 200 : res.status, jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "products-update failed" } };
    }
  }
});