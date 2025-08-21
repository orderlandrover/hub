import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

// POST /api/products-update
// Body: { ids:number[], status?, price?, stock_quantity?, categoryId? }
app.http("products-update-bulk", {
  route: "products-update",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      let body: any = {};
      try { body = await req.json(); } catch { /* tom body ok */ }

      const ids: number[] = Array.isArray(body?.ids) ? body.ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n)) : [];
      if (ids.length === 0) return { status: 400, jsonBody: { error: "ids is required (array of product IDs)" } };

      const patch: any = {};
      if (body?.status) patch.status = String(body.status);
      if (body?.price !== undefined) patch.regular_price = String(body.price);
      if (typeof body?.stock_quantity === "number") patch.stock_quantity = body.stock_quantity;
      if (typeof body?.categoryId === "number") patch.categories = [{ id: Number(body.categoryId) }];

      const results: any[] = [];
      for (const id of ids) {
        const res = await wcFetch(`/products/${id}`, {
          method: "PUT",
          body: JSON.stringify(patch),
        });
        const text = await res.text();
        let parsed: any;
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        results.push({ id, ok: res.ok, status: res.status, body: parsed });
      }

      const updated = results.filter(r => r.ok).length;
      return { status: 200, jsonBody: { updated, results } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || "products-update bulk failed" } };
    }
  }
});