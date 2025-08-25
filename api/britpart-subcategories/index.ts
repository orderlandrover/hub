import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartJson, BritpartCategory } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

app.http("britpart-subcategories", {
  route: "britpart-subcategories",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (_req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      // “All Parts” har id=3 hos Britpart – där ligger alla toppnivåers underkategorier
      const root = await britpartJson<BritpartCategory>("getcategories?categoryId=3");

      const subs: BritpartCategory[] = Array.isArray(root?.subcategories) ? root.subcategories! : [];
      const items = subs
        .filter(s => typeof s?.id === "number" && !!s.title)
        .map(s => ({ id: String(s.id), name: s.title }));

      return { status: 200, jsonBody: { items }, headers: CORS };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e?.message || String(e) }, headers: CORS };
    }
  }
});