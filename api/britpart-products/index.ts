import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type PartsResponse = {
  ok: boolean;
  mode: "single" | "multi";
  total?: number;       // från källsidan (single)
  totalPages?: number;  // från källsidan (single)
  page?: number;        // vilken sida som returneras (single)
  count: number;        // antal items i 'parts'
  parts: any[];
  details?: any;        // per underkategori debug vid multi
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
      const pageSize = Number(u.searchParams.get("pageSize") || 200); // tillåt större sidor
      const code = u.searchParams.get("code") || undefined;
      const modifiedSince = u.searchParams.get("modifiedSince") || undefined;
      const subcategoryId = u.searchParams.get("subcategoryId") || undefined;

      // stöd för flera underkategorier: ?subcategoryIds=62,44,43
      const subcategoryIdsParam = (u.searchParams.get("subcategoryIds") || "")
        .split(",").map(s => s.trim()).filter(Boolean);

      // --- MULTI-MODE: hämta alla sidor för exakt de angivna underkategorierna ---
      if (subcategoryIdsParam.length > 0) {
        const all: any[] = [];
        const details: Record<string, { pages: number; fetched: number }> = {};

        for (const sid of subcategoryIdsParam) {
          let p = 1;
          let fetchedForSid = 0;
          let totalPagesForSid = 1;

          while (true) {
            const res = await britpartFetch("/part/getall", { page: p, pageSize, code, modifiedSince, subcategoryId: sid });
            const text = await res.text();
            if (!res.ok) throw new Error(`Britpart getall ${res.status}: ${text.slice(0, 160)}`);

            const j = JSON.parse(text);
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
          params: { subcategoryIds: subcategoryIdsParam, pageSize, code, modifiedSince }
        };

        return { status: 200, jsonBody: out, headers: CORS };
      }

      // --- SINGLE-MODE: behåll ditt gamla beteende (en sida) ---------------------
      const res = await britpartFetch("/part/getall", { page, pageSize, code, modifiedSince, subcategoryId });
      const text = await res.text();
      if (!res.ok) throw new Error(`Britpart getall ${res.status}: ${text.slice(0, 160)}`);

      const j = JSON.parse(text);
      const parts = Array.isArray(j.parts) ? j.parts : [];
      const out: PartsResponse = {
        ok: true,
        mode: "single",
        total: Number(j.total ?? (Array.isArray(j.parts) ? j.parts.length : 0)),
        totalPages: Number(j.totalPages ?? 1),
        page: Number(j.page ?? page),
        count: parts.length,
        parts,
        params: { subcategoryId, page, pageSize, code, modifiedSince }
      };

      return { status: 200, jsonBody: out, headers: CORS };
    } catch (e: any) {
      return { status: 500, jsonBody: { ok: false, error: e?.message || "britpart-products failed" }, headers: CORS };
    }
  },
});