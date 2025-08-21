import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

type Body = {
  sku: string;
  name?: string;
  price?: string;
  stock?: number;
  categoryId?: number;
  status?: "publish" | "draft";
  image?: string;
};

app.http("import-one", {
  route: "import-one",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return { status: 200, headers: cors };

    try {
      const body = (await req.json()) as Body;
      const sku = (body?.sku || "").trim();
      if (!sku) return { status: 400, jsonBody: { error: "sku is required" }, headers: cors };

      // Finns befintlig produkt?
      const existingRes = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
      const existing = await existingRes.json();
      const exists = Array.isArray(existing) && existing.length > 0;

      const payload: any = {
        sku,
        name: body?.name,
        regular_price: body?.price,
        status: body?.status || "publish",
      };
      if (typeof body?.stock === "number") payload.stock_quantity = body.stock;
      if (typeof body?.categoryId === "number") payload.categories = [{ id: body.categoryId }];
      if (body?.image) payload.images = [{ src: body.image }];

      let res: Response;
      if (exists) {
        const id = existing[0].id;
        res = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        res = await wcFetch(`/products`, { method: "POST", body: JSON.stringify(payload) });
      }

      const text = await res.text();
      let data: any; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      if (!res.ok) {
        return { status: 502, jsonBody: { error: "WooCommerce error", detail: data }, headers: cors };
      }
      return { status: 200, jsonBody: data, headers: cors };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "import-one failed" }, headers: { "Access-Control-Allow-Origin": "*" } };
    }
  }
});