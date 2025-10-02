// api/wc-products-verify.ts
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { wooGetProduct } from "./_woo";

app.http("wc-products-verify", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "wc-products-verify",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    try {
      const idsParam = (req.query.get("ids") || "").trim();
      if (!idsParam) return { status: 400, jsonBody: { error: "ids query required" } };
      const ids = idsParam.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);

      const items = [];
      for (const id of ids) {
        try {
          const p = await wooGetProduct(id);
          items.push({ id: p.id, categories: p.categories, date_modified_gmt: p.date_modified_gmt });
        } catch (e: any) {
          items.push({ id, error: e?.message || String(e) });
        }
      }
      return { status: 200, jsonBody: { ok: true, items } };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e?.message || String(e) } };
    }
  },
});
