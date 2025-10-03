// auth-login
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { credentialsOk, setAuthCookie } from "../shared/auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
} as const;

app.http("auth-login", {
  route: "auth-login",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const { username, password } = (await req.json()) as any;
      if (!credentialsOk(String(username || ""), String(password || ""))) {
        return { status: 401, headers: CORS, jsonBody: { ok: false, error: "Fel användarnamn/lösenord" } };
      }
      const headers: Record<string, string> = { ...CORS };
      // Viktigt: setAuthCookie ska sätta headers["Set-Cookie"] med Path=/; Secure; HttpOnly; SameSite=None
      setAuthCookie(headers, String(username));
      return { status: 200, headers, jsonBody: { ok: true } };
    } catch (e: any) {
      return { status: 400, headers: CORS, jsonBody: { ok: false, error: String(e?.message || e) } };
    }
  }
});
