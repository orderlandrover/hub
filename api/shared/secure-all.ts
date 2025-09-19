// api/shared/secure-all.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import jwt from "jsonwebtoken";
import { env } from "./env";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
} as const;

// Endpoints som ska vara öppna (ingen auth)
const ALLOW = new Set<string>([
  "auth-login",
  "auth-logout",
  "auth-me",
  "ping",
]);

function unauthorized(): HttpResponseInit {
  return { status: 401, headers: CORS, jsonBody: { ok: false, error: "Not authenticated" } };
}

function readCookie(req: HttpRequest, name: string) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// Gör patchen bara en gång (vid hot-reload körs moduler om)
const KEY = "__secure_all_patched__";
if (!(globalThis as any)[KEY]) {
  (globalThis as any)[KEY] = true;

  // Spara original
  const originalHttp = app.http.bind(app);

  // Ersätt app.http med en variant som wrappar handlern
  (app as any).http = (name: string, options: any) => {
    // Låt tillåtna endpoints registreras oförändrade
    if (ALLOW.has(name)) return originalHttp(name, options);

    const rawHandler = options?.handler;
    if (typeof rawHandler !== "function") return originalHttp(name, options);

    const wrapped = async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
      // Släpp alltid igenom preflight
      if (req.method === "OPTIONS") return rawHandler(req, ctx);

      // Kolla JWT i cookie
      try {
        const token = readCookie(req, "hub_auth");
        if (!token) return unauthorized();
        jwt.verify(token, env.AUTH_SECRET);
      } catch {
        return unauthorized();
      }
      // Vid OK → kör originalhandler
      const res = await rawHandler(req, ctx);
      // Se till att CORS finns i svar (behövs ofta i UI)
      if (res && typeof res === "object") {
        (res.headers as any) = { ...(res.headers || {}), ...CORS };
      }
      return res;
    };

    return originalHttp(name, { ...options, handler: wrapped });
  };
}
