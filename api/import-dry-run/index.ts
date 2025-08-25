// ImportDryRun/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetPartCodesForCategories } from "../shared/britpart";

type Body = {
  categoryIds?: number[]; // toppnivå eller mellan-nivå
  debug?: boolean;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

app.http("import-dry-run", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "import-dry-run",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    // Handle CORS preflight quickly
    if (req.method === "OPTIONS") {
      return { status: 204, headers: CORS_HEADERS };
    }

    const started = Date.now();

    try {
      let body: Body | undefined;
      try {
        body = (await req.json()) as Body;
      } catch {
        // tom body eller ej JSON
        return {
          status: 400,
          headers: CORS_HEADERS,
          jsonBody: { ok: false, error: "Request body måste vara JSON med { categoryIds: number[] }" },
        };
      }

      const categoryIds = (body?.categoryIds ?? [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n));

      if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
        return { status: 400, headers: CORS_HEADERS, jsonBody: { ok: false, error: "categoryIds (number[]) krävs" } };
      }

      // REKURSIV expansion → alla bladens partCodes
      const partCodesRaw = await britpartGetPartCodesForCategories(categoryIds);

      // Säkerställ unika koder & städa upp whitespace
      const partCodes = Array.from(
        new Set(
          (partCodesRaw ?? [])
            .filter((s) => typeof s === "string")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        )
      );

      const total = partCodes.length;

      // Debugdetaljer
      const elapsedMs = Date.now() - started;
      const debugPayload: Record<string, any> | undefined = body?.debug
        ? {
            inCategoryIds: categoryIds,
            expandedCodesCount: total,
            elapsedMs,
          }
        : undefined;

      // Heuristisk varning om något uppenbart är fel
      const warnings: string[] = [];
      if (body?.debug && total <= categoryIds.length) {
        warnings.push(
          "Lågt antal produkter relativt antal categoryIds. Kontrollera att du kör senaste 'api/shared/britpart.ts' med normalizeCategory + rekursion på sc.id."
        );
      }

      const resp = {
        ok: true,
        total,
        summary: {
          create: 0,     // uppdatera när du jämför mot Woo
          update: total,
          skip: 0,
        },
        sample: partCodes.slice(0, 10).sort(),
        debug: debugPayload,
        warnings: warnings.length ? warnings : undefined,
      };

      if (body?.debug) {
        ctx.log("Dry-run DEBUG", resp.debug);
        if (warnings.length) ctx.log("Dry-run WARN", warnings);
      }

      return { status: 200, headers: CORS_HEADERS, jsonBody: resp };
    } catch (e: any) {
      ctx.error("Dry-run error", e);
      return { status: 500, headers: CORS_HEADERS, jsonBody: { ok: false, error: String(e?.message ?? e) } };
    }
  },
});