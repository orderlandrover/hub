// api/shared/britpart.ts
import { env } from "./env";

/** --------------------------------------------------------------- */
/** Bas / tokens                                                     */
/** --------------------------------------------------------------- */
const BRITPART_BASE = (env.BRITPART_BASE || "").replace(/\/$/, "");
const BRITPART_TOKEN = env.BRITPART_TOKEN || "";

/** --------------------------------------------------------------- */
/** Typer                                                            */
/** --------------------------------------------------------------- */

export type BritpartImportItem = {
  sku: string;                // Britpart "code"
  name?: string;
  description?: string;
  imageUrl?: string;          // första bildens URL
  imageUrls?: string[];       // alla bilder
  categoryId?: number;        // subcategoryId vi hämtade från
};

export type BritpartCategoryResponse = {
  id: number;
  title?: string;
  url?: string;
  partCodes?: string[];
  subcategoryIds?: number[];
  subcategories?: Array<{
    id: number;
    title?: string;
    partCodes?: string[];
    subcategoryIds?: number[];
  }>;
};

/** --------------------------------------------------------------- */
/** Helpers                                                          */
/** --------------------------------------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function safeJson<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`Britpart JSON parse error ${res.status}: ${txt.slice(0, 300)}`);
  }
}

function buildApiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const seg = path.startsWith("/") ? path : `/${path}`;
  return `${BRITPART_BASE}/api/v1${seg}`;
}

/**
 * Fetch mot Britpart med:
 *  - Token i headern
 *  - Backoff på 429/5xx
 *  - Okända fält i init → query-param om method är GET
 */
export async function britpartFetchRaw(
  path: string,
  init?: RequestInit | Record<string, any>
): Promise<Response> {
  const urlBase = buildApiUrl(path);

  const knownInit: RequestInit = {};
  const maybeParams: Record<string, any> = {};

  if (init && typeof init === "object") {
    const knownKeys: (keyof RequestInit)[] = [
      "method","headers","body","mode","credentials","cache","redirect",
      "referrer","referrerPolicy","integrity","keepalive","signal","window"
    ];
    for (const [k, v] of Object.entries(init)) {
      if ((knownKeys as string[]).includes(k)) {
        // @ts-expect-error internal assign
        knownInit[k] = v as any;
      } else {
        maybeParams[k] = v;
      }
    }
  }

  let url = urlBase;
  const method = (knownInit.method ?? "GET").toString().toUpperCase();
  if (method === "GET" && Object.keys(maybeParams).length > 0) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(maybeParams)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((vv) => usp.append(k, String(vv)));
      else usp.set(k, String(v));
    }
    url += (url.includes("?") ? "&" : "?") + usp.toString();
  }

  const headers: Record<string, string> = {
    ...(knownInit.headers as Record<string, string> | undefined),
    "Content-Type": "application/json",
    Token: BRITPART_TOKEN,
  };

  let lastErr: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { ...knownInit, headers });
      if (res.ok) return res;

      if (res.status === 429 || res.status >= 500) {
        await sleep(400 + attempt * 300);
        continue;
      }
      const body = await res.text();
      throw new Error(`Britpart ${res.status}: ${body}`);
    } catch (e) {
      lastErr = e;
      await sleep(400 + attempt * 300);
    }
  }
  throw lastErr ?? new Error("Britpart call failed");
}

/** --------------------------------------------------------------- */
/** Kategori-endpoints (behövs för UI)                               */
/** --------------------------------------------------------------- */

export async function getCategory(id: number): Promise<BritpartCategoryResponse> {
  const res = await britpartFetchRaw(`/part/getcategories?id=${id}`);
  const json = await safeJson(res);
  const obj = json?.items ?? json ?? {};
  return {
    id: Number(obj?.id),
    title: obj?.title,
    url: obj?.url,
    partCodes: Array.isArray(obj?.partCodes) ? obj.partCodes : undefined,
    subcategoryIds: Array.isArray(obj?.subcategoryIds)
      ? obj.subcategoryIds.map((n: any) => Number(n))
      : undefined,
    subcategories: Array.isArray(obj?.subcategories)
      ? obj.subcategories.map((s: any) => ({
          id: Number(s?.id),
          title: s?.title,
          partCodes: Array.isArray(s?.partCodes) ? s.partCodes : undefined,
          subcategoryIds: Array.isArray(s?.subcategoryIds)
            ? s.subcategoryIds.map((n: any) => Number(n))
            : undefined,
        }))
      : undefined,
  };
}

export async function getRootCategories(): Promise<BritpartCategoryResponse> {
  return getCategory(3);
}

/** --------------------------------------------------------------- */
/** GETALL: subkategori → alla delar (paginering)                    */
/** --------------------------------------------------------------- */

function normalizeGetAllItem(raw: any, subcategoryId: number): BritpartImportItem | undefined {
  const sku = String(raw?.code ?? "").trim();
  if (!sku) return undefined;

  const imageUrls: string[] = Array.isArray(raw?.imageUrls)
    ? raw.imageUrls.filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u))
    : [];

  return {
    sku,
    name: raw?.title ?? undefined,
    description: raw?.subText ?? "",
    imageUrl: imageUrls[0],
    imageUrls,
    categoryId: subcategoryId,
  };
}

/**
 * Hämtar ALLA parts för EN subkategori via /part/getall i loop.
 * Token läggs både i header OCH som query-param (som din PHP-plugin).
 */
export async function britpartGetAllBySubcategory(
  subcategoryId: number
): Promise<BritpartImportItem[]> {
  const out: BritpartImportItem[] = [];
  let page = 1;

  for (;;) {
    const res = await britpartFetchRaw("/part/getall", {
      subcategoryId,
      page,
      token: BRITPART_TOKEN, // kompatibelt med legacy-plugin
    });
    const json = await safeJson<any>(res);
    const parts: any[] =
      Array.isArray(json?.parts) ? json.parts :
      Array.isArray(json?.items) ? json.items :
      Array.isArray(json)        ? json : [];

    if (!parts.length) break;

    for (const it of parts) {
      const norm = normalizeGetAllItem(it, subcategoryId);
      if (norm) out.push(norm);
    }
    page++;
  }

  return out;
}

/** Flera subkategorier → concat + dedupe på SKU */
export async function britpartGetAllBySubcategories(
  categoryIds: number[]
): Promise<BritpartImportItem[]> {
  const all: BritpartImportItem[] = [];
  for (const id of categoryIds) {
    const chunk = await britpartGetAllBySubcategory(Number(id));
    all.push(...chunk);
  }
  const seen = new Set<string>();
  const deduped: BritpartImportItem[] = [];
  for (const it of all) {
    if (!it.sku || seen.has(it.sku)) continue;
    seen.add(it.sku);
    deduped.push(it);
  }
  return deduped;
}

/** Bakåtkompatibel: ge bara part-codes (SKU) för givna subkategorier */
export async function britpartGetPartCodesForCategories(categoryIds: number[]): Promise<string[]> {
  const items = await britpartGetAllBySubcategories(categoryIds);
  const out = new Set<string>();
  for (const it of items) {
    if (it?.sku) {
      const s = String(it.sku).trim();
      if (s) out.add(s);
    }
  }
  return Array.from(out);
}

/** Bakåtkompatibel export */
export { britpartFetchRaw as britpartFetch };
