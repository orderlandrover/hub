// api/britpart-getall/index.ts
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { britpartGet } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

type PartsResponse = {
  total: number;
  totalPages: number;
  page: number;
  parts: any[];
};

app.http("britpart-getall", {
  route: "britpart-getall",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      const u = new URL(req.url);
      const page = Number(u.searchParams.get("page") || 1);
      const code = u.searchParams.get("code") || undefined;
      const modifiedSince = u.searchParams.get("modifiedSince") || undefined;

      const j = await britpartGet<any>("/part/getall", { page, code, modifiedSince });
      const out: PartsResponse = {
        total: Number(j.total ?? (Array.isArray(j.parts) ? j.parts.length : 0)),
        totalPages: Number(j.totalPages ?? 1),
        page: Number(j.page ?? page),
        parts: Array.isArray(j.parts) ? j.parts : [],
      };

      return { status: 200, headers: CORS, jsonBody: out };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { error: e?.message || "britpart-getall failed" } };
    }
  },
});
