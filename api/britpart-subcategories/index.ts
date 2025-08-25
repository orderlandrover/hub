// api/britpart-subcategories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getRootCategories, BritpartCategory } from "../shared/britpart";

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
      const root: BritpartCategory = await getRootCategories();
      // root.subcategories = de översta (40..60 osv)
      const items = (root.subcategories ?? []).map((c) => ({ id: String(c.id), name: c.title }));
      return { status: 200, jsonBody: { items }, headers: CORS };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e.message }, headers: CORS };
    }
  },
});