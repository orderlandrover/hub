// api/import-dry-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetPartCodesForCategories } from "../shared/britpart";

type Body = {
  categoryIds?: number[]; // Britpart underkategorier (IDs)
  debug?: boolean;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

app.http("import-dry-run", {
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  route: "import-dry-run",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    if (req.method === "GET")     return { status: 200, headers: CORS, jsonBody: { ok: true, name: "import-dry-run" } };

    const started = Date.now();

    try {
      let body: Body | undefined;
      try {
        body = (await req.json()) as Body;
      } catch {
        return {
          status: 400,
          headers: CORS,
          jsonBody: { ok: false, error: "Body måste vara JSON. Ex: { \"categoryIds\": [44,45] }" }
        };
      }

      const categoryIds = (body?.categoryIds ?? [])
        .map(Number)
        .filter((n) => Number.isFinite(n));

      if (categoryIds.length === 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "categoryIds (number[]) krävs" } };
      }

      // Expandera rekursivt -> alla part codes under dessa kategorier
      const raw = await britpartGetPartCodesForCategories(categoryIds);

      // Städa & unika koder
      const partCodes = Array.from(
        new Set(
          (raw ?? [])
            .filter((s) => typeof s === "string")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        )
      );

      const total = partCodes.length;

      const debug: Record<string, any> | undefined = body?.debug
        ? { inCategoryIds: categoryIds, expandedCodesCount: total, elapsedMs: Date.now() - started }
        : undefined;

      const resp = {
        ok: true,
        total,
        summary: { create: 0, update: total, skip: 0 }, // indikativt – verkliga siffror kommer i import-run
        sample: partCodes.slice(0, 10).sort(),
        debug
      };

      if (debug) ctx.log("dry-run debug", debug);

      return { status: 200, headers: CORS, jsonBody: resp };
    } catch (e: any) {
      ctx.error("import-dry-run error", e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message ?? e) } };
    }
  }
});