// api/import-dry-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetPartCodesForCategories } from "../shared/britpart";

/* ------------------------------- CORS ------------------------------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Body = {
  categoryIds: number[];
  limit?: number;
};

function jsonOk(data: Record<string, any> = {}): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: true, ...data } };
}
function jsonFail(message: string, extra?: Record<string, any>): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: false, error: message, ...(extra || {}) } };
}

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    if (req.method === "GET") {
      return jsonOk({ name: "import-dry-run" });
    }

    let body: Body | undefined;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonFail("Invalid JSON body");
    }
    if (!body?.categoryIds?.length) return jsonFail("categoryIds required");

    try {
      const limit = Math.max(0, Number(body.limit ?? 0));
      let codes = await britpartGetPartCodesForCategories(body.categoryIds);

      // TS-typa pilar → inga implicit any
      codes = codes
        .filter((s: unknown): s is string => typeof s === "string")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      if (limit > 0) codes = codes.slice(0, limit);

      return jsonOk({ total: codes.length, codes });
    } catch (e: any) {
      return jsonFail(e?.message || "Dry-run failure");
    }
  },
});
