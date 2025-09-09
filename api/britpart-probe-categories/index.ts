// api/britpart-probe-categories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  britpartCollectLeaves,
  britpartGetPartCodesForCategories,
} from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: unknown) => (e && typeof (e as any).message === "string" ? String((e as any).message) : String(e));

app.http("britpart-probe-categories", {
  route: "britpart-probe-categories",
  methods: ["POST", "GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      let ids: number[] | null = null;

      if (req.method === "GET") {
        const q = (req.query.get("ids") || "").trim();
        if (q) {
          ids = q
            .split(/[,\s]+/)
            .map((s: string) => Number(s))
            .filter((n: number) => Number.isFinite(n));
        }
      } else {
        const raw: unknown = await req.json().catch(() => null);
        const body = (raw && typeof raw === "object" ? (raw as { ids?: unknown }) : {});
        if (Array.isArray(body.ids)) {
          ids = (body.ids as unknown[])
            .map((v: unknown) => Number(v as any))
            .filter((n: number) => Number.isFinite(n));
        }
      }

      if (!ids || ids.length === 0) {
        return {
          status: 400,
          headers: CORS,
          jsonBody: { ok: false, error: "Missing 'ids' (array of numbers)" },
        };
      }

      ctx.log?.(`probe-categories: ids=${ids.join(", ")}`);

      // 1) Alla unika SKU under valda rötter
      const allCodes = await britpartGetPartCodesForCategories(ids);
      const uniqueSkuCount = new Set(allCodes).size;
      const sampleAll = allCodes.slice(0, 10);

      // 2) Leaf-noder med counts + samples
      const leavesRaw = await britpartCollectLeaves(ids);
      const leaves = leavesRaw
        .map((l) => ({ leafId: l.id, count: l.count, sampleSkus: l.sample }))
        .sort((a, b) => b.count - a.count);

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          inputIds: ids,
          uniqueSkuCount,
          leaves,
          sampleAll,
        },
      };
    } catch (e: unknown) {
      const msg = emsg(e);
      ctx.error?.(msg);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: msg } };
    }
  },
});
