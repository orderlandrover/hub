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
        category_id?: number;
        category_ids?: number[];
        stock_quantity?: number;
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
      if (body.category_ids?.length) {
        patch.categories = body.category_ids.map((id) => ({ id }));
      } else if (body.category_id) {
        patch.categories = [{ id: body.category_id }];
      }

      const results = [] as any[];
      for (const id of body.ids) {
        const res = await wcRequest(`/products/${id}`, {
          method: "PUT",
          body: JSON.stringify(patch),
        });
        results.push(await res.json());
      }

      return { jsonBody: { ok: true, count: results.length } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});
