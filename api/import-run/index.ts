import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetByCategories, britpartGetPartCodesForCategories } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

app.http("import-run", {
  route: "import-run",      // -> /api/import-run
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const { ids, pageSize, roundingMode, roundTo } = (await req.json()) as {
        ids: number[];
        pageSize?: number;
        roundingMode?: "none" | "nearest" | "up" | "down";
        roundTo?: number;
      };

      if (!Array.isArray(ids) || ids.length === 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No ids" } };
      }

      // 1) Hämta alla partCodes (rekursivt ner till blad)
      const partCodes = await britpartGetPartCodesForCategories(ids);

      // 2) (Valfritt) mappa till importobjekt – du har redan hjälparen:
      const items = await britpartGetByCategories(ids);

      // 3) TODO: Koppla mot din Woo-import här om du vill göra “riktig import”.
      // await importToWoo(items, { pageSize, roundingMode, roundTo });

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          receivedIds: ids,
          pageSize: pageSize ?? null,
          roundingMode: roundingMode ?? "none",
          roundTo: roundTo ?? 1,
          countPartCodes: partCodes.length,
          leafIds: "(beräknas via partCodes, ej returnerade separat)",
          sample: partCodes.slice(0, 10), // litet smakprov för att se att det funkar
        },
      };
    } catch (e: any) {
      ctx.error?.(e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message || e) } };
    }
  },
});
