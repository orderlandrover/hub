import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { requireAuth } from "../shared/auth";

const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type"
} as const;

app.http("auth-me",{
  route:"auth-me",
  methods:["GET","OPTIONS"],
  authLevel:"anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    try {
      const user = await requireAuth(req, ctx);
      return { status: 200, headers: CORS, jsonBody: { ok:true, user } };
    } catch {
      return { status: 401, headers: CORS, jsonBody: { ok:false } };
    }
  }
});
