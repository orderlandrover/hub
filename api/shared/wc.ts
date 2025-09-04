// api/shared/wc.ts
import { env } from "./env";

/**
 * ENV som stöds (alla är valfria alias, välj en uppsättning):
 *  - WP_URL / WC_BASE  (ex: https://landroverdelar.se) – ingen slash på slutet
 *  - WC_KEY / WC_CONSUMER_KEY
 *  - WC_SECRET / WC_CONSUMER_SECRET
 */

/* --------------------------------------------------------------- */
/* Säker env-läsning                                               */
/* --------------------------------------------------------------- */

function getWooConfig() {
  const baseRaw =
    (env as any)?.WP_URL ??
    (env as any)?.WC_BASE ??
    process.env.WP_URL ??
    process.env.WC_BASE ??
    "";

  const key =
    (env as any)?.WC_KEY ??
    (env as any)?.WC_CONSUMER_KEY ??
    process.env.WC_KEY ??
    process.env.WC_CONSUMER_KEY ??
    "";

  const secret =
    (env as any)?.WC_SECRET ??
    (env as any)?.WC_CONSUMER_SECRET ??
    process.env.WC_SECRET ??
    process.env.WC_CONSUMER_SECRET ??
    "";

  const base = String(baseRaw).replace(/\/+$/, "");
  if (!base) throw new Error("Woo env saknas: WP_URL eller WC_BASE");
  if (!key || !secret) throw new Error("Woo env saknas: WC_KEY/WC_SECRET (eller WC_CONSUMER_KEY/_SECRET)");

  const authHeader = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");

  return { base, key, secret, authHeader };
}

/* --------------------------------------------------------------- */
/* Typer                                                           */
/* --------------------------------------------------------------- */

export type WooStatus = "publish" | "draft" | "private" | "pending";

export type WooUpdate = {
  id: number;
  regular_price?: string;
  status?: WooStatus;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: "instock" | "outofstock" | "onbackorder";
};

/* --------------------------------------------------------------- */
/* Helpers                                                         */
/* --------------------------------------------------------------- */

function ensureLeadingSlash(p: string) {
  return p.startsWith("/") ? p : `/${p}`;
}

/** Bygg en full REST-URL mot Woo */
function buildUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/wp-json")) return `${base}${path}`;
  return `${base}/wp-json/wc/v3${ensureLeadingSlash(path)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readJsonSafe<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`WC JSON parse error ${res.status}: ${txt.slice(0, 300)}`);
  }
}

/* --------------------------------------------------------------- */
/* wcFetch med backoff + auth-fallback                             */
/* --------------------------------------------------------------- */

export async function wcFetch(path: string, init?: RequestInit): Promise<Response> {
  const { base, key, secret, authHeader } = getWooConfig();
  const urlBase = buildUrl(base, path);

  // Försök 1: Basic auth. Om 401/403 → försök 2: query-auth.
  let tryQueryAuth = false;

  let lastErr: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
      ...(tryQueryAuth ? {} : { Authorization: authHeader }),
    };

    // Lägg till query-auth endast när vi bestämt oss att prova fallback
    const url = tryQueryAuth
      ? (() => {
          const u = new URL(urlBase);
          u.searchParams.set("consumer_key", key);
          u.searchParams.set("consumer_secret", secret);
          return u.toString();
        })()
      : urlBase;

    try {
      const res = await fetch(url, { ...init, headers });
      if (res.ok) return res;

      // 401/403 => prova en gång med query-auth (många hostningar blockerar Basic på PUT/POST)
      if (!tryQueryAuth && (res.status === 401 || res.status === 403)) {
        tryQueryAuth = true;
        continue;
      }

      // 429/5xx => backoff, annars kasta feltext
      if (res.status === 429 || res.status >= 500) {
        await sleep(400 + attempt * 300);
        continue;
      }

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
/* Bekvämligheter                                                   */
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

/** Hämta produkt via SKU → returnera första träffen eller null */
export async function wcFindProductIdBySku(sku: string): Promise<number | null> {
  const res = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
  if (!res.ok) return null;
  const arr = await readJsonSafe<any[]>(res);
  return Array.isArray(arr) && arr[0]?.id ? Number(arr[0].id) : null;
}

/** Batch-uppdatera produkter (max 100 per request). Returnerar antal uppdaterade. */
export async function wcBatchUpdateProducts(updates: WooUpdate[]): Promise<number> {
  if (!updates.length) return 0;

  let done = 0;
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    const res = await wcPostJSON<{ update?: any[] }>(`/products/batch`, { update: chunk });
    done += Array.isArray(res.update) ? res.update.length : 0;
  }
  return done;
}
