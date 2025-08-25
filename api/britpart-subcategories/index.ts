import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartJson } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

app.http("britpart-subcategories", {
  route: "britpart-subcategories",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      // Parent category "All Parts" is id=3
      const rootId = Number(req.query.get("rootId") ?? 3);

      // Britpart endpoint that returns category + nested "subcategories"
      const data = await britpartJson<{ subcategories?: any[] }>("/part/getcategories", {
        categoryId: rootId,
      });

      const items =
        (data?.subcategories ?? []).map((s: any) => ({
          id: String(s.id),
          name: String(s.title ?? s.name ?? s.id),
        })) ?? [];

      return { status: 200, jsonBody: { items }, headers: CORS };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e?.message || String(e) }, headers: CORS };
    }
  },
});