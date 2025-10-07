import { app, HttpRequest, HttpResponseInit } from "@azure/functions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
} as const;

app.http("auth-diag", {
  route: "auth-diag",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    try {
      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          node: process.version,
          has_AUTH_USER: !!process.env.AUTH_USER,
          has_AUTH_PASS: !!process.env.AUTH_PASS,
          AUTH_SECRET_len: (process.env.AUTH_SECRET || "").length
        }
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: String(e?.message || e) } };
    }
  }
});
