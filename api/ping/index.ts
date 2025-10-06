import { app, HttpRequest, HttpResponseInit } from "@azure/functions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
} as const;

app.http("ping", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "ping",
  handler: async (_req: HttpRequest): Promise<HttpResponseInit> => {
    if (_req.method === "OPTIONS") return { status: 204, headers: CORS };
    return { status: 200, headers: CORS, jsonBody: { ok: true, t: Date.now() } };
  }
});
