// api/shared/wc.ts
import { env } from "./env";

/**
 * ENV som används:
 *  - WP_URL     (https://landroverdelar.se) – ingen trailing slash
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

export type WooImage = {
  id?: number;
  src?: string;
  name?: string;
  alt?: string;
  position?: number;
};

export type WooMeta = { key: string; value: any };

export type WooUpdate = {
  id: number;

  // Pris/lagersaker
  regular_price?: string;
  status?: WooStatus;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: "instock" | "outofstock" | "onbackorder";

  // Fält vi sätter i importen
  name?: string;
  description?: string;
  short_description?: string;
  images?: WooImage[];
  meta_data?: WooMeta[];

  // Kategorier (kan uppdateras på existerande produkter)
  categories?: { id: number }[];
};

export type WooCreate = {
  name: string;
  sku: string;
  type?: "simple" | "external" | "grouped" | "variable";
  status?: WooStatus; // vi brukar köra "draft" när pris saknas
  regular_price?: string;
  description?: string;
  short_description?: string;
  categories?: { id: number }[];
  images?: WooImage[];
  meta_data?: WooMeta[];
};

export type WCCategoryPayload = {
  name: string;
  parent?: number;
  slug?: string;
  description?: string;
  meta_data?: Array<{ key: string; value: any }>;
};

/* --------------------------------------------------------------- */
/* Utils                                                           */
/* --------------------------------------------------------------- */

export const wooEnvOk = () => Boolean(WP_URL && WC_KEY && WC_SECRET);

function requireEnv() {
  if (!wooEnvOk()) {
    throw new Error("Woo env saknas: WP_URL/WC_KEY/WC_SECRET");
  }
}

function authHeader(): string {
  // Woo v3: Basic auth (måste vara över HTTPS – vilket WP_URL är)
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

/** Läs body som JSON, kasta vettigt fel om det inte är JSON */
export async function readJsonSafe<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`WC JSON parse error ${res.status}: ${txt.slice(0, 500)}`);
  }
}

/* --------------------------------------------------------------- */
/* wcFetch med exponential-ish backoff och felhantering            */
/* --------------------------------------------------------------- */

type FetchInit = RequestInit & { retry?: number };

export async function wcFetch(path: string, init?: FetchInit): Promise<Response> {
  requireEnv();
  const url = buildUrl(path);
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  const maxAttempts = Math.max(1, Math.min(7, (init?.retry ?? 5) + 1));
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });

      if (res.ok) return res;

      // 429/5xx ⇒ backoff + retry
      if (res.status === 429 || res.status >= 500) {
        const wait = 400 + attempt * 350; // mild ökning
        await sleep(wait);
        continue;
      }

      // Övriga fel: kasta med text
      const body = await res.text();
      throw new Error(`Woo ${res.status} ${res.statusText}: ${body}`);
    } catch (e) {
      lastErr = e;
      // nätverksfel/timeouts ⇒ backoff och försök igen
      const wait = 400 + attempt * 350;
      await sleep(wait);
    }
  }

  throw lastErr ?? new Error("wcFetch failed");
}

/* --------------------------------------------------------------- */
/* Små bekvämligheter                                               */
/* --------------------------------------------------------------- */

export async function wcGetJSON<T = any>(path: string): Promise<T> {
  const res = await wcFetch(path, { method: "GET" });
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

export async function wcDeleteJSON<T = any>(path: string): Promise<T> {
  const res = await wcFetch(path, { method: "DELETE" });
  return readJsonSafe<T>(res);
}

/* --------------------------------------------------------------- */
/* Produkt-helpers                                                  */
/* --------------------------------------------------------------- */

/** Hämta produkt via SKU → returnera första träffen eller null */
export async function wcFindProductIdBySku(sku: string): Promise<number | null> {
  const res = await wcFetch(`/products?sku=${encodeURIComponent(sku)}&per_page=1`, { method: "GET" });
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
    const res = await wcPostJSON<{ update?: Array<{ id: number }> }>(`/products/batch`, { update: chunk });
    done += Array.isArray(res.update) ? res.update.length : 0;
  }
  return done;
}

/** Batch-skapa produkter (max 100 / request). Returnerar antal skapade + deras IDs. */
export async function wcBatchCreateProducts(items: WooCreate[]): Promise<{ count: number; ids: number[] }> {
  if (!items.length) return { count: 0, ids: [] };

  let count = 0;
  const ids: number[] = [];
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    const res = await wcPostJSON<{ create?: Array<{ id: number }> }>(`/products/batch`, { create: chunk });
    const created = Array.isArray(res.create) ? res.create : [];
    count += created.length;
    for (const c of created) if (c?.id) ids.push(Number(c.id));
  }
  return { count, ids };
}

/* --------------------------------------------------------------- */
/* Kategori-helpers                                                 */
/* --------------------------------------------------------------- */

export async function wcGetAllCategories(): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page < 999; page++) {
    const arr = await wcGetJSON<any[]>(`/products/categories?per_page=100&page=${page}`);
    if (!Array.isArray(arr) || !arr.length) break;
    out.push(...arr);
    if (arr.length < 100) break;
  }
  return out;
}

export async function wcCreateCategory(payload: WCCategoryPayload): Promise<any> {
  return wcPostJSON(`/products/categories`, payload);
}

export async function wcUpdateCategory(id: number, payload: Partial<WCCategoryPayload>): Promise<any> {
  return wcPutJSON(`/products/categories/${id}`, payload);
}

/** Exakt namnjämförelse (case-insensitive) + parent */
export async function wcEnsureCategory(
  name: string,
  parent?: number,
  meta?: Record<string, any>
): Promise<number> {
  const all = await wcGetAllCategories();
  const n = name.trim().toLowerCase();
  const match = all.find(
    (c) => String(c.name || "").trim().toLowerCase() === n && Number(c.parent || 0) === Number(parent || 0)
  );
  if (match?.id) return Number(match.id);

  const meta_data = meta ? Object.entries(meta).map(([key, value]) => ({ key, value })) : undefined;
  const created = await wcCreateCategory({ name, parent, meta_data });
  return Number(created.id);
}
