import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcFetch } from "../shared/wc";

// POST /api/products-delete
// Body: { ids:number[] }
app.http("products-delete-bulk", {
  route: "products-delete",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      let body: any = {};
      try { body = await req.json(); } catch { /* tom body ok */ }

      const ids: number[] = Array.isArray(body?.ids) ? body.ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n)) : [];
      if (ids.length === 0) return { status: 400, jsonBody: { error: "ids is required (array of product IDs)" } };

      const results: any[] = [];
      for (const id of ids) {
        const res = await wcFetch(`/products/${id}?force=true`, { method: "DELETE" });
        const text = await res.text();
        let parsed: any;
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        results.push({ id, ok: res.ok, status: res.status, body: parsed });
      }

      const deleted = results.filter(r => r.ok).length;
      return { status: 200, jsonBody: { deleted, results } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || "products-delete bulk failed" } };
    }
  }
});