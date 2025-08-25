// api/import-dry-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { collectPartCodesFrom } from "../shared/britpart";
import { wcFindProductBySku } from "../shared/wc";

type Body = { subcategoryIds: Array<string | number> };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-dry-run" }, headers: CORS };

    try {
      const body = (await req.json()) as Body;
      const ids = (body?.subcategoryIds || []).map((x) => Number(x)).filter(Boolean);
      if (!ids.length) return { status: 400, jsonBody: { error: "missing subcategoryIds" }, headers: CORS };

      const t0 = Date.now();
      const allCodes = new Set<string>();
      const visited = new Set<number>();

      for (const id of ids) {
        const { partCodes, visited: v } = await collectPartCodesFrom(id);
        partCodes.forEach((c) => allCodes.add(c));
        v.forEach((n) => visited.add(n));
      }

      let exists = 0;
      let missing = 0;
      for (const code of allCodes) {
        const p = await wcFindProductBySku(code);
        if (p) exists++; else missing++;
      }

      return {
        status: 200,
        jsonBody: {
          ok: true,
          summary: { create: missing, update: exists, skip: 0 },
          counts: {
            inputSubcategories: ids.length,
            discoveredSubcategories: visited.size,
            uniquePartCodes: allCodes.size,
          },
          elapsedMs: Date.now() - t0,
        },
        headers: CORS,
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || String(e) }, headers: CORS };
    }
  },
});