// api/shared/secure-all.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { verifyToken, readCookie as readAuthCookie } from "./auth"; // <-- använd vår HMAC-token

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
} as const;

// öppna endpoints (ingen auth)
const ALLOW = new Set<string>(["auth-login", "auth-logout", "auth-me", "ping","auth-diag"]);

function unauthorized(): HttpResponseInit {
  return { status: 401, headers: CORS, jsonBody: { ok: false, error: "Not authenticated" } };
}

function getToken(req: HttpRequest): string | undefined {
  // 1) försök läsa vår cookie
  const c = readAuthCookie(req);
  if (c) return c;

  // 2) stöd även Authorization: Bearer <token>
  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m?.[1];
}

// Gör patchen bara en gång
const KEY = "__secure_all_patched__";
if (!(globalThis as any)[KEY]) {
  (globalThis as any)[KEY] = true;

  const originalHttp = app.http.bind(app);

  (app as any).http = (name: string, options: any) => {
    if (ALLOW.has(name)) return originalHttp(name, options);

    const rawHandler = options?.handler;
    if (typeof rawHandler !== "function") return originalHttp(name, options);

    const wrapped = async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
      // preflight
      if (req.method === "OPTIONS") return { status: 204, headers: CORS };

      try {
        const tok = getToken(req);
        verifyToken(tok); // kastar vid ogiltig/utgången token
      } catch {
        return unauthorized();
      }

      const res = await rawHandler(req, ctx);
      if (res && typeof res === "object") {
        (res.headers as any) = { ...(res.headers || {}), ...CORS };
      }
      return res;
    };

    return originalHttp(name, { ...options, handler: wrapped });
  };
}
