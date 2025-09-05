// api/shared/wc.ts
import { env } from "./env";

/**
 * ENV som används:
 *  - WP_URL     (ex: https://landroverdelar.se) – ingen slash på slutet
 *  - WC_KEY     (Woo consumer key)
 *  - WC_SECRET  (Woo consumer secret)
 */

const WP_URL = (env.WP_URL || "").replace(/\/+$/, "");
const WC_KEY = env.WC_KEY || "";
const WC_SECRET = env.WC_SECRET || "";

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

function requireEnv() {
  if (!WP_URL || !WC_KEY || !WC_SECRET) {
    throw new Error("Woo env saknas: WP_URL/WC_KEY/WC_SECRET");
  }
}

function authHeader(): string {
  return "Basic " + Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
}

function ensureLeadingSlash(p: string) {
  return p.startsWith("/") ? p : `/${p}`;
}

/** Bygg en full URL mot WP/Woo */
function buildUrl(path: string): string {
  if (!/^https?:\/\//i.test(path)) {
    if (path.startsWith("/wp-json")) return `${WP_URL}${path}`;
    path = `/wp-json/wc/v3${ensureLeadingSlash(path)}`;
    return `${WP_URL}${path}`;
  }
  return path;
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
/* wcFetch med enkel backoff                                       */
/* --------------------------------------------------------------- */

export async function wcFetch(path: string, init?: RequestInit): Promise<Response> {
  requireEnv();
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

      // 429/5xx => backoff
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
  if (Array.isArray(arr) && arr[0]?.id) return Number(arr[0].id);
  return null;
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
