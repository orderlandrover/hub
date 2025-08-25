// api/import-dry-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { collectPartCodesForSubcategoryIds } from "../shared/britpart";

type Body = {
  subcategoryIds?: Array<number | string>; // valda ID från UI
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET")     return { status: 200, jsonBody: { ok: true, name: "import-dry-run" }, headers: CORS };

    try {
      const body = (await req.json()) as Body;
      const ids = Array.isArray(body?.subcategoryIds) ? body!.subcategoryIds! : [];

      if (ids.length === 0) {
        return {
          status: 400,
          jsonBody: { error: "Saknar subcategoryIds (array av id:n)" },
          headers: CORS,
        };
      }

      // Hämta alla partnummer från valda underkategorier
      const codes = await collectPartCodesForSubcategoryIds(ids);

      // Svara med en lättöverskådlig sammanställning (dry-run, ingen WC-ändring)
      return {
        status: 200,
        jsonBody: {
          ok: true,
          selectedSubcategories: ids.length,
          uniquePartCodes: codes.size,
          sample: [...codes].slice(0, 20), // skicka med 20 st för insyn
        },
        headers: CORS,
      };
    } catch (e: any) {
      ctx.error("import-dry-run failed", e);
      return { status: 500, jsonBody: { error: e?.message || String(e) }, headers: CORS };
    }
  },
});