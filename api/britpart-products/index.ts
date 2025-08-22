import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type PartsResponse = {
  total: number;
  totalPages: number;
  page: number;
  parts: any[];
};

app.http("britpart-products", {
  route: "api/britpart-products",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      const u = new URL(req.url);
      const page = Number(u.searchParams.get("page") || 1);
      const code = u.searchParams.get("code") || undefined;
      const modifiedSince = u.searchParams.get("modifiedSince") || undefined;
      const subcategoryId = u.searchParams.get("subcategoryId") || undefined; // valfritt filter

      const res = await britpartFetch("/part/getall", { page, code, modifiedSince, subcategoryId });
      const text = await res.text();
      if (!res.ok) throw new Error(`Britpart getall ${res.status}: ${text.slice(0, 160)}`);

      const j = JSON.parse(text);
      const out: PartsResponse = {
        total: Number(j.total ?? (Array.isArray(j.parts) ? j.parts.length : 0)),
        totalPages: Number(j.totalPages ?? 1),
        page: Number(j.page ?? page),
        parts: Array.isArray(j.parts) ? j.parts : [],
      };

      return { status: 200, jsonBody: out, headers: CORS };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e?.message || "britpart-products failed" }, headers: CORS };
    }
  },
});
