// api/britpart-probe-categories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  britpartCollectLeaves,
  britpartGetPartCodesForCategories,
  getCategory,
} from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));

type ProbeInput = { ids?: unknown };

app.http("britpart-probe-categories", {
  route: "britpart-probe-categories",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const raw = (await req.json().catch(() => ({}))) as ProbeInput;
      const ids = Array.isArray(raw?.ids)
        ? (raw.ids as any[]).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
        : [];

      if (!ids.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "No ids" } };
      }

      // 1) Samla “blad” (leaf-kategorier) och alla SKU
      const leaves = await britpartCollectLeaves(ids);
      const allCodes = await britpartGetPartCodesForCategories(ids);
      const unique = Array.from(new Set(allCodes));

      // 2) Debug-info per input-id (så vi ser vad API:t faktiskt returnerar)
      const debugNodes: Array<{
        inputId: number;
        returnedId: number | null;
        title: string | null;
        partCodesCount: number;
        childIds: number[];
        error?: string;
      }> = [];

      for (const id of ids) {
        try {
          const cat = await getCategory(id);
          const childIds = [
            ...(Array.isArray(cat.subcategories) ? cat.subcategories.map((s: any) => Number(s?.id)) : []),
            ...(Array.isArray(cat.subcategoryIds) ? cat.subcategoryIds.map((n: any) => Number(n)) : []),
          ].filter((n: number) => Number.isFinite(n));

          debugNodes.push({
            inputId: id,
            returnedId: Number((cat as any).id) || null,
            title: (cat as any).title ?? null,
            partCodesCount: Array.isArray(cat.partCodes) ? cat.partCodes.length : 0,
            childIds,
          });
        } catch (e: any) {
          debugNodes.push({
            inputId: id,
            returnedId: null,
            title: null,
            partCodesCount: 0,
            childIds: [],
            error: emsg(e),
          });
        }
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          inputIds: ids,
          uniqueSkuCount: unique.length,
          sampleAll: unique.slice(0, 10),
          leaves: leaves.map((l) => ({ leafId: l.id, count: l.count, sampleSkus: l.sample })),
          debug: { nodes: debugNodes },
        },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: emsg(e) } };
    }
  },
});
