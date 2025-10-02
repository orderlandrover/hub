// api/britpart-products/index.ts
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { britpartGet } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

type PartsResponse = {
  ok: boolean;
  mode: "single" | "multi";
  total?: number;
  totalPages?: number;
  page?: number;
  count: number;
  parts: any[];
  details?: any;
  params: Record<string, any>;
};

app.http("britpart-products", {
  route: "britpart-products",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      const u = new URL(req.url);
      const page = Number(u.searchParams.get("page") || 1);
      const pageSize = Number(u.searchParams.get("pageSize") || 200);
      const code = u.searchParams.get("code") || undefined;
      const modifiedSince = u.searchParams.get("modifiedSince") || undefined;
      const subcategoryId = u.searchParams.get("subcategoryId") || undefined;

      // Stöd för flera underkategorier: ?subcategoryIds=62,44,43
      const subcategoryIds = (u.searchParams.get("subcategoryIds") || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      if (subcategoryIds.length > 0) {
        const all: any[] = [];
        const details: Record<string, { pages: number; fetched: number }> = {};

        for (const sid of subcategoryIds) {
          let p = 1;
          let fetchedForSid = 0;
          let totalPagesForSid = 1;

          while (true) {
            const j = await britpartGet<any>("/part/getall", {
              page: p,
              pageSize,
              code,
              modifiedSince,
              subcategoryId: sid,
            });

            const parts = Array.isArray(j.parts) ? j.parts : [];
            all.push(...parts);
            fetchedForSid += parts.length;

            totalPagesForSid = Number(j.totalPages ?? totalPagesForSid);
            if (!parts.length || p >= totalPagesForSid) break;
            p++;
          }

          details[sid] = { pages: totalPagesForSid, fetched: fetchedForSid };
        }

        const out: PartsResponse = {
          ok: true,
          mode: "multi",
          count: all.length,
          parts: all,
          details,
          params: { subcategoryIds, pageSize, code, modifiedSince },
        };
        return { status: 200, headers: CORS, jsonBody: out };
      }

      // Single-mode
      const j = await britpartGet<any>("/part/getall", { page, pageSize, code, modifiedSince, subcategoryId });
      const parts = Array.isArray(j.parts) ? j.parts : [];
      const out: PartsResponse = {
        ok: true,
        mode: "single",
        total: Number(j.total ?? parts.length),
        totalPages: Number(j.totalPages ?? 1),
        page: Number(j.page ?? page),
        count: parts.length,
        parts,
        params: { subcategoryId, page, pageSize, code, modifiedSince },
      };

      return { status: 200, headers: CORS, jsonBody: out };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: e?.message || "britpart-products failed" } };
    }
  },
});
