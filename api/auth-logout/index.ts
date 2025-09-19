import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { clearAuthCookie } from "../shared/auth";

const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type"
} as const;

app.http("auth-logout",{
  route:"auth-logout",
  methods:["POST","OPTIONS"],
  authLevel:"anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    const headers: Record<string,string> = { ...CORS };
    clearAuthCookie(headers);
    return { status: 200, headers, jsonBody: { ok:true } };
  }
});
