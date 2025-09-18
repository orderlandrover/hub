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

/** Woo bildobjekt enligt REST API */
export type WooImage = {
  id?: number;
  src?: string;
  name?: string;
  alt?: string;
  position?: number;
};

/** Key/Value-meta som lagras på produkten */
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

  // 🔸 NYTT: möjliggör uppdatering av kategorier på existerande produkter
  categories?: { id: number }[];
};

export type WooCreate = {
  name: string;
  sku: string;
  type?: "simple" | "external" | "grouped" | "variable";
  status?: WooStatus; // "draft" som default när vi saknar pris
  regular_price?: string;
  description?: string;
  short_description?: string;
  categories?: { id: number }[];
  images?: WooImage[];
  meta_data?: WooMeta[];
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
  // per_page=1 gör svaret lite snabbare och mindre
  const res = await wcFetch(`/products?sku=${encodeURIComponent(sku)}&per_page=1`);
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
/* Woo categories helpers                                          */
/* --------------------------------------------------------------- */

export type WCCategoryPayload = {
  name: string;
  parent?: number;
  slug?: string;
  description?: string;
  meta_data?: Array<{ key: string; value: any }>;
};

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
export async function wcEnsureCategory(name: string, parent?: number, meta?: Record<string, any>): Promise<number> {
  const all = await wcGetAllCategories();
  const n = name.trim().toLowerCase();
  const match = all.find((c) => String(c.name || "").trim().toLowerCase() === n && Number(c.parent || 0) === Number(parent || 0));
  if (match?.id) return Number(match.id);
  const meta_data = meta ? Object.entries(meta).map(([key, value]) => ({ key, value })) : undefined;
  const created = await wcCreateCategory({ name, parent, meta_data });
  return Number(created.id);
}

