import { env as getEnv } from "./env";

/** Hämta env med tydliga fel */
function ENV(name: string) {
  const v = getEnv(name, true);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Bas-URL för Woo REST */
function wcBase(): string {
  const base = ENV("WP_URL").replace(/\/$/, "");
  return `${base}/wp-json/wc/v3`;
}

/** Bygger standardheaders (Basic Auth, JSON) */
function defaultHeaders(body?: BodyInit | null): Headers {
  const h = new Headers();
  const token = Buffer.from(`${ENV("WC_KEY")}:${ENV("WC_SECRET")}`).toString("base64");
  h.set("Authorization", `Basic ${token}`);
  h.set("Accept", "application/json");
  if (body) h.set("Content-Type", "application/json");
  return h;
}

/** Low-level fetch mot Woo, kastar läsbart fel vid HTML/text-svar */
export async function wcFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${wcBase()}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(init.headers || {});
  const std = defaultHeaders(init.body ?? null);
  std.forEach((v, k) => { if (!headers.has(k)) headers.set(k, v); });

  const res = await fetch(url, { ...init, headers });

  // Om inte OK och/eller inte JSON → läs text och kasta tydligt fel
  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (!ct.includes("application/json")) {
      throw new Error(`Woo ${init.method || "GET"} ${url} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    // JSON-fel, men behåll texten i felet
    throw new Error(`Woo ${init.method || "GET"} ${url} -> ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

/** PUT/DELETE fallback via POST + X-HTTP-Method-Override/Query */
export async function wcFetchWithOverride(
  path: string,
  method: "PUT" | "DELETE" | "POST",
  payload?: unknown
): Promise<Response> {
  const body = payload ? JSON.stringify(payload) : undefined;

  // Försök “native”
  try {
    return await wcFetch(path, { method, body });
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    // Proxy/WAF problem? Testa override med POST
    if (/(405|501|502|Backend|Method Not Allowed|Bad Gateway)/i.test(msg) && method !== "POST") {
      const overridePath = `${path}${path.includes("?") ? "&" : "?"}_method=${method}`;
      const res2 = await wcFetch(overridePath, { method: "POST", body });
      return res2;
    }
    throw e;
  }
}