import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartJson } from "../shared/britpart";

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: (string|number)[] };
      const ids = Array.isArray(body?.subcategoryIds) ? body.subcategoryIds : [];
      if (ids.length === 0) return { status: 400, jsonBody: { error: "subcategoryIds required" } };

      // Hämta delar per underkategori
      const perCat = [] as Array<{ id: string|number; count: number }>;
      let total = 0;
      for (const id of ids) {
        // RÄTT path: /part/getall?subcategory=ID
        const data = await britpartJson(`/part/getall?subcategory=${encodeURIComponent(String(id))}`);
        // Anta att svaret har en lista i "parts" eller direkt som array – hantera båda
        const parts = Array.isArray(data) ? data : Array.isArray(data?.parts) ? data.parts : [];
        perCat.push({ id, count: parts.length });
        total += parts.length;
      }

      return {
        jsonBody: {
          ok: true,
          subcategories: perCat,
          summary: { total }
        }
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});