import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartFetch, makeBritpartUrl } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

app.http("britpart-subcategories", {
  route: "britpart-subcategories",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (_req.method === "OPTIONS") return { status: 200, headers: CORS };
    try {
      const url = makeBritpartUrl("/part/getcategories", { categoryId: 3 });
      const res = await britpartFetch("/part/getcategories", { categoryId: 3 });
      const text = await res.text();
      if (!res.ok) throw new Error(`Britpart getcategories ${res.status}: ${text.slice(0,180)} (url=${url})`);
      const j = JSON.parse(text);

      const items = (j.subcategories || []).map((s: any) => ({
        id: String(s.id),
        name: String(s.title || s.name || s.id)
      }));
      return { status: 200, jsonBody: { items }, headers: CORS };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message }, headers: CORS };
    }
  }
});