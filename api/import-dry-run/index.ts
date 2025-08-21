import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetCategories } from "../shared/britpart";

type Body = { subcategoryIds?: string[] };

app.http("import-dry-run", {
  route: "import-dry-run",
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
      const ids = Array.isArray(body?.subcategoryIds) ? body!.subcategoryIds! : [];
      if (!ids.length) return { status: 400, jsonBody: { error: "subcategoryIds required" }, headers: cors };

      const details: Array<{ id: string; parts: number }> = [];
      let totalParts = 0;

      for (const sid of ids) {
        const cat = await britpartGetCategories(Number(sid));
        const parts = Array.isArray(cat?.partCodes) ? cat.partCodes.length : 0;
        details.push({ id: String(sid), parts });
        totalParts += parts;
      }

      // Grov uppskattning: säg att 70% behöver uppdateras, 20% skapas, 10% hoppas över.
      const summary = {
        totalParts,
        update: Math.round(totalParts * 0.7),
        create: Math.round(totalParts * 0.2),
        skip: totalParts - Math.round(totalParts * 0.7) - Math.round(totalParts * 0.2),
      };

      return { status: 200, jsonBody: { ok: true, details, summary }, headers: cors };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "import-dry-run failed" }, headers: cors };
    }
  }
});