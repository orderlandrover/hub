import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("products-update", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as {
        ids: number[];
        status?: "publish" | "draft" | "pending" | "private";
        price?: string;
        stock_quantity?: number;
        categoryId?: number;
      };

      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return { status: 400, jsonBody: { error: "ids required" } };
      }

      const patch: any = {};
      if (body.status) patch.status = body.status;
      if (body.price != null) patch.regular_price = String(body.price);
      if (body.stock_quantity != null) {
        patch.manage_stock = true;
        patch.stock_quantity = body.stock_quantity;
        patch.stock_status = body.stock_quantity > 0 ? "instock" : "outofstock";
      }
      if (body.categoryId) {
        patch.categories = [{ id: body.categoryId }];
      }

      // Skicka i mindre batchar för att undvika rate limits
      for (const id of body.ids) {
        await wcRequest(`/products/${id}`, {
          method: "PUT",
          body: JSON.stringify(patch),
        });
      }

      return { jsonBody: { ok: true, count: body.ids.length } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
