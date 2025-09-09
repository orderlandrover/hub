// api/britpart-probe-categories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartCollectLeaves, britpartGetPartCodesForCategories } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));

function parseIdsCsv(s: string | null | undefined): number[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

app.http("britpart-probe-categories", {
  route: "britpart-probe-categories",
  methods: ["POST", "GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      let ids: number[] = [];
      let limit = 5;

      if (req.method === "GET") {
        // Stöd för snabb test: /api/britpart-probe-categories?ids=40,44&limit=5
        ids = parseIdsCsv(req.query.get("ids")) || parseIdsCsv(req.query.get("id"));
        const qLimit = Number(req.query.get("limit") || "5");
        if (Number.isFinite(qLimit)) limit = qLimit;
      } else {
        // POST body: { ids: number[], limit?: number }
        const body = (await req.json().catch(() => null)) as any | null;
        if (body && Array.isArray(body.ids)) {
          ids = body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0);
        }
        if (body && body.limit !== undefined) {
          const bLimit = Number(body.limit);
          if (Number.isFinite(bLimit)) limit = bLimit;
        }
      }

      if (!ids.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No ids" } };
      }

      // Rimliga gränser
      limit = Math.min(Math.max(limit, 1), 50);

      // 1) Hämta blad (kategorier som faktiskt har partCodes) för transparens
      const leavesRaw = await britpartCollectLeaves(ids); // [{ id, title?, count, sample:string[] }]
      const leaves = leavesRaw
        .map((l) => ({
          id: l.id,
          title: l.title,
          count: Number(l.count) || 0,
          sample: Array.isArray(l.sample) ? l.sample.slice(0, limit) : [],
        }))
        .sort((a, b) => b.count - a.count);

      // 2) Union av unika SKU:er (samma som import-run använder)
      const allCodes = await britpartGetPartCodesForCategories(ids);
      const totalSkus = allCodes.length;
      const sampleSkus = allCodes.slice(0, Math.min(10, limit));

      ctx.log?.(
        `probe: roots=[${ids.join(", ")}] leaves=${leaves.length} totalSkus=${totalSkus} limit=${limit}`
      );

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          roots: ids,
          totalSkus,
          totalLeaves: leaves.length,
          leaves,
          sampleSkus,
        },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: emsg(e) } };
    }
  },
});
