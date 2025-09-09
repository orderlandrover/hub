// api/britpart-probe-categories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  britpartCollectLeaves,
  britpartGetPartCodesForCategories,
  LeafInfo,
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
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const body = (await req.json().catch(() => ({}))) as { ids?: number[]; pageSize?: number };
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
      if (!ids.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "Missing ids" } };
      }

      // 1) Ta reda på vilka “blad” (leafs) som faktiskt innehåller koder
      const leaves: LeafInfo[] = await britpartCollectLeaves(ids);

      // 2) Räkna fram unionen av SKU under rötterna
      const allSkus = await britpartGetPartCodesForCategories(ids);

      // 3) Svar med sammanfattning + tabell per blad
      const sampleSkus = allSkus.slice(0, 8);

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          roots: ids,
          uniqueSku: allSkus.length,
          sampleSkus,
          leaves: leaves.map(l => ({
            id: l.id,
            title: l.title || "",
            skuCount: l.count,
            sample: l.sample,
          })),
        },
      };
    } catch (e: any) {
      ctx.error?.(e);
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: emsg(e) } };
    }
  },
});
