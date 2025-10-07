// api/shared/secure-all.ts
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
  HttpFunctionOptions,
  HttpMethod,
} from "@azure/functions";
import { verifyToken, readCookie as readAuthCookie } from "./auth";

// Öppna endpoints (ingen auth)
const OPEN = new Set<string>(["auth-login", "auth-logout", "auth-me", "ping", "auth-diag"]);

function corsHeaders(req: HttpRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
  if (origin) {
    // När cookies används får inte "*" användas
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  } else {
    h["Access-Control-Allow-Origin"] = "*";
  }
  return h;
}

function json(status: number, body: unknown, extra?: Record<string, string>): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(extra || {}) },
  };
}

function getToken(req: HttpRequest): string | undefined {
  // 1) Cookie från /api/auth-login
  const c = readAuthCookie(req);
  if (c) return c;

  // 2) Authorization: Bearer <token>
  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m?.[1];
}

// Patcha bara en gång (p.g.a. hot-reload lokalt)
const KEY = "__secure_all_patched__";
if (!(globalThis as any)[KEY]) {
  (globalThis as any)[KEY] = true;

  const originalHttp = app.http.bind(app);

  (app as any).http = (name: string, options: HttpFunctionOptions) => {
    // Lämna whitelistan orörd
    if (OPEN.has(name)) return originalHttp(name, options);

    const rawHandler = (options as HttpFunctionOptions)?.handler as
      | ((req: HttpRequest, ctx: InvocationContext) => Promise<HttpResponseInit> | HttpResponseInit)
      | undefined;

    if (typeof rawHandler !== "function") {
      return originalHttp(name, options);
    }

    const wrapped = async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
      // CORS preflight
      if (req.method === "OPTIONS") {
        return { status: 204, headers: { ...corsHeaders(req) } };
      }

      // Auth-kontroll
      try {
        const tok = getToken(req);
        verifyToken(tok); // kastar vid saknad/ogiltig/utgången token
      } catch (err) {
        ctx.log?.("secure-all 401", (err as Error)?.message);
        return json(401, { ok: false, error: "Not authenticated" }, corsHeaders(req));
      }

      // Kör riktiga handlern
      try {
        const res = await rawHandler(req, ctx);
        const headers = { ...(res?.headers || {}), ...corsHeaders(req) };
        return { ...res, headers };
      } catch (err) {
        ctx.log?.("secure-all handler error", err);
        return json(500, { ok: false, error: "Internal error" }, corsHeaders(req));
      }
    };

    // Skicka tillbaka exakt samma options (korrekt typ) men med vår wrapper
    const patched: HttpFunctionOptions = { ...(options as HttpFunctionOptions), handler: wrapped };
    return originalHttp(name, patched);
  };
}
