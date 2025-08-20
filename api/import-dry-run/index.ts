import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetAll } from "../shared/britpart";

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      const body = (await req.json()) as {
        subcategoryIds: string[];
        // (valfritt i framtiden) categoryMap?: Record<string, number>;
      };

      const ids = Array.isArray(body?.subcategoryIds) ? body!.subcategoryIds : [];
      if (ids.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      }

      const perSub: Array<{ subcategory: string; count: number }> = [];
      let total = 0;

      // Hämta listor per vald underkategori
      for (const id of ids) {
        // Viktigt: Britpart har token som query param (och/eller "Token" header)
        const r = await britpartGetAll({ subcategory: id });
        // API:t kan returnera olika former; normalisera
        const j = await r.json();
        const items: any[] = Array.isArray(j) ? j : (j.items || j.data || []);
        perSub.push({ subcategory: id, count: items.length });
        total += items.length;
      }

      // Här kan vi i nästa steg jämföra mot WC /products?sku=... för att få create/update/skip.
      return {
        jsonBody: {
          summary: { create: total, update: 0, skip: 0 }, // placeholders tills diff mot WC är på plats
          perSub,
        },
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || "Import dry-run failed" } };
    }
  },
});