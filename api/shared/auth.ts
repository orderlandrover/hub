import { HttpRequest, InvocationContext } from "@azure/functions";
import crypto from "crypto";

const COOKIE = "hub_auth";
const USER   = process.env.AUTH_USER   || "admin";
const PASS   = process.env.AUTH_PASS   || "changeme";
const SECRET = process.env.AUTH_SECRET || "change-this-to-long-random";
const TTL_H  = Math.max(1, Number(process.env.AUTH_TTL_HOURS || "12"));

type Session = { u: string; exp: number };

function b64u(s: Buffer | string) {
  const buf = Buffer.isBuffer(s) ? s : Buffer.from(String(s));
  return buf.toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function hmac(payload: string) {
  return b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());
}
function serializeCookie(name: string, val: string, maxAgeSec: number) {
  const parts = [
    `${name}=${val}`,
    `Path=/`,
    `SameSite=Lax`,
    `HttpOnly`,
    `Secure`,
    `Max-Age=${maxAgeSec}`
  ];
  return parts.join("; ");
}

/** Skapa signerat sessionstoken */
export function makeToken(username: string) {
  const exp = Math.floor(Date.now()/1000) + TTL_H * 3600;
  const payload = b64u(Buffer.from(JSON.stringify({ u: username, exp } as Session)));
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

/** Validera token från cookie, returnera användare eller throw 401 */
export function verifyToken(token?: string): string {
  if (!token) throw new Error("401");
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw new Error("401");
  if (hmac(payload) !== sig) throw new Error("401");
  const sess = JSON.parse(Buffer.from(payload.replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()) as Session;
  if (!sess?.u || !sess?.exp || Date.now()/1000 > sess.exp) throw new Error("401");
  return sess.u;
}

/** Läs cookie-värde */
export function readCookie(req: HttpRequest, name = COOKIE): string | undefined {
  const raw = req.headers.get("cookie") || "";
  const m = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(raw);
  return m?.[1];
}

/** Sätt auth-cookie i headers */
export function setAuthCookie(headers: Record<string,string>, username: string) {
  const tok = makeToken(username);
  headers["Set-Cookie"] = serializeCookie(COOKIE, tok, TTL_H*3600);
}

/** Radera cookie */
export function clearAuthCookie(headers: Record<string,string>) {
  headers["Set-Cookie"] = serializeCookie(COOKIE, "", 0);
}

/** Kontroll: kastar 401 om ej inloggad */
export async function requireAuth(req: HttpRequest, _ctx: InvocationContext): Promise<string> {
  const tok = readCookie(req);
  try {
    return verifyToken(tok);
  } catch {
    const e: any = new Error("Unauthorized");
    (e.status = 401);
    throw e;
  }
}

/** Enkel jämförelse av credentials från body */
export function credentialsOk(u: string, p: string) {
  // stöder komma-separerad lista: AUTH_USER="admin,anna"  AUTH_PASS="pw1,pw2"
  const users = USER.split(",").map(s => s.trim());
  const passw = PASS.split(",").map(s => s.trim());
  for (let i=0;i<users.length;i++) if (u===users[i] && p===(passw[i]||"")) return true;
  return false;
}
