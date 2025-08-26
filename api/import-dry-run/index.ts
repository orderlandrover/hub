// api/import-dry-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetPartCodesForCategories } from "../shared/britpart";

type Body = {
  categoryIds?: number[];
  debug?: boolean;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

app.http("import-dry-run", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "import-dry-run",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    const started = Date.now();

    try {
      let body: Body | undefined;
      try {
        body = (await req.json()) as Body;
      } catch {
        return {
          status: 400,
          headers: CORS,
          jsonBody: { ok: false, error: "Body måste vara JSON: { categoryIds: number[] }" },
        };
      }

      const categoryIds = (body?.categoryIds ?? [])
        .map(Number)
        .filter((n) => Number.isFinite(n));

      if (categoryIds.length === 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "categoryIds (number[]) krävs" } };
      }

      const partCodesRaw = await britpartGetPartCodesForCategories(categoryIds);
      const partCodes = Array.from(
        new Set((partCodesRaw ?? [])
          .filter((s) => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean))
      );

      const total = partCodes.length;
      const elapsedMs = Date.now() - started;

      const resp = {
        ok: true,
        total,
        summary: { create: 0, update: total, skip: 0 },
        sample: partCodes.slice(0, 10).sort(),
        debug: body?.debug ? { inCategoryIds: categoryIds, expandedCodesCount: total, elapsedMs } : undefined,
      };

      if (body?.debug) ctx.log("Dry-run debug:", resp.debug);

      return { status: 200, headers: CORS, jsonBody: resp };
    } catch (e: any) {
      ctx.error("import-dry-run error", e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message ?? e) } };
    }
  },
});