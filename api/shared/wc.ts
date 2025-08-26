// api/shared/wc.ts
import { env } from "./env";

const WP_URL = env.WP_URL.replace(/\/$/, "");
const WC_KEY = env.WC_KEY;
const WC_SECRET = env.WC_SECRET;

/* --------------------------------------------------------------- */
/* helpers                                                         */
/* --------------------------------------------------------------- */

function authHeader(): string {
  return "Basic " + Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
}

function ensureLeadingSlash(p: string) {
  return p.startsWith("/") ? p : `/${p}`;
}

/** Bygg en full URL mot WP/Woo:
 * - Om path börjar med "http" → returnera som den är.
 * - Om path börjar med "/wp-json" → prefixed med WP_URL.
 * - Annars → tolka som Woo-route och prefixa "/wp-json/wc/v3".
 */
function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/wp-json")) return `${WP_URL}${path}`;
  return `${WP_URL}/wp-json/wc/v3${ensureLeadingSlash(path)}`;
}

/** Liten delay */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Säker JSON-parse med förbättrat felmeddelande – används brett */
export async function readJsonSafe<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`WC JSON parse error ${res.status}: ${txt.slice(0, 300)}`);
  }
}

/* --------------------------------------------------------------- */
/* wcFetch med backoff                                              */
/* --------------------------------------------------------------- */

/** wcFetch:
 * - Prefixar bas-url korrekt
 * - Sätter auth + JSON headers
 * - Retries/backoff på 429/5xx
 */
export async function wcFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = buildUrl(path);
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  let lastErr: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.ok) return res;

      if (res.status === 429 || res.status >= 500) {
        // enkel exponential-ish backoff
        await sleep(400 + attempt * 300);
        continue;
      }
      // för 4xx (utom 429) – kasta direkt med kropp för bättre felsökning
      const body = await res.text();
      throw new Error(`Woo ${res.status}: ${body}`);
    } catch (e) {
      lastErr = e;
      await sleep(400 + attempt * 300);
    }
  }
  throw lastErr ?? new Error("wcFetch failed");
}

/* --------------------------------------------------------------- */
/* Små bekvämligheter                                               */
/* --------------------------------------------------------------- */

export async function wcGetJSON<T = any>(path: string): Promise<T> {
  const res = await wcFetch(path);
  return readJsonSafe<T>(res);
}

export async function wcPostJSON<T = any>(path: string, payload: any): Promise<T> {
  const res = await wcFetch(path, { method: "POST", body: JSON.stringify(payload) });
  return readJsonSafe<T>(res);
}

export async function wcPutJSON<T = any>(path: string, payload: any): Promise<T> {
  const res = await wcFetch(path, { method: "PUT", body: JSON.stringify(payload) });
  return readJsonSafe<T>(res);
}

export async function wcDelete(path: string): Promise<Response> {
  return wcFetch(path, { method: "DELETE" });
}

/** Hämta alla sidor för en Woo-endpoint som stödjer per_page/page */
export async function wcListAll<T = any>(route: string, perPage = 100): Promise<T[]> {
  let page = 1;
  const out: T[] = [];
  for (;;) {
    const res = await wcFetch(`${route}${route.includes("?") ? "&" : "?"}per_page=${perPage}&page=${page}`);
    const chunk = await readJsonSafe<T[]>(res);
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < perPage) break;
    page++;
  }
  return out;
}

/* --------------------------------------------------------------- */
/* Vanliga operationer                                              */
/* --------------------------------------------------------------- */

export async function wcFindProductBySku(sku: string): Promise<any | null> {
  const res = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
  if (!res.ok) return null;
  const arr = await readJsonSafe<any[]>(res);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

export async function wcCreateProduct(payload: any): Promise<Response> {
  return wcFetch(`/products`, { method: "POST", body: JSON.stringify(payload) });
}

export async function wcUpdateProduct(id: number, payload: any): Promise<Response> {
  return wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}