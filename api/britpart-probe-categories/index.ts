// api/britpart-probe-categories/index.ts
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import {
  britpartCollectLeaves,
  britpartGetPartCodesForCategories,
} from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));

app.http("britpart-probe-categories", {
  route: "britpart-probe-categories",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const body = (await req.json().catch(() => ({}))) as { ids?: number[] };
      const ids = (Array.isArray(body?.ids) ? body.ids : []).map((n) => Number(n)).filter(Boolean);
      if (!ids.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No ids" } };
      }

      // 1) Totala unika SKU under rötterna
      const codes = await britpartGetPartCodesForCategories(ids);
      const uniqueCount = new Set(codes).size;

      // 2) Leaf-uppdelning (blad som faktiskt innehåller partCodes)
      const leaves = await britpartCollectLeaves(ids);

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          rootIds: ids,
          uniqueSkuTotal: uniqueCount,
          leafCount: leaves.length,
          leaves, // [{ id, title, count, sample: [..] }]
        },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: emsg(e) } };
    }
  },
});
