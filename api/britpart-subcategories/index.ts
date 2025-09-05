import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getCategory } from "../shared/britpart";

/** CORS för UI */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

app.http("britpart-subcategories", {
  route: "britpart-subcategories",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") {
      return { status: 204, headers: CORS };
    }

    // Snabb hälsokoll: /api/britpart-subcategories?ping=1
    if (req.query.get("ping") === "1") {
      return { status: 200, headers: CORS, jsonBody: { ok: true, name: "britpart-subcategories" } };
    }

    try {
      // Standard: visa DIREKTA barn till root(3), som i din tidigare UI-lista
      const parentId = Number(req.query.get("parent") ?? 3);
      const parent = await getCategory(parentId);

      // Normalisera svaret till enkel lista som UI:t redan stödjer
      const items =
        (parent.subcategories ?? []).map(sc => ({
          id: Number(sc.id),
          title: sc.title ?? String(sc.id),
          parentId, // bra för UI/debug
        }));

      return { status: 200, headers: CORS, jsonBody: { items } };
    } catch (e: any) {
      const msg = e?.message || String(e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: msg } };
    }
  },
});
