// api/shared/britpart.ts
import { env } from "./env";

/** Bas och token (matchar dina miljövariabler i Azure) */
const BRITPART_BASE = (env.BRITPART_BASE || "https://www.britpart.com").replace(/\/+$/, "");
const BRITPART_TOKEN = env.BRITPART_TOKEN || "";

/* --------------------------------------------------------------- */
/* Tunables                                                        */
/* --------------------------------------------------------------- */
const ENV_ANY = env as Record<string, unknown>;
const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number(ENV_ANY.BRITPART_CONCURRENCY ?? process.env.BRITPART_CONCURRENCY ?? 6)
);
const THROTTLE_MS = Math.max(
  0,
  Number(ENV_ANY.BRITPART_THROTTLE_MS ?? process.env.BRITPART_THROTTLE_MS ?? 120)
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ensureConfigured() {
  if (!BRITPART_BASE || !BRITPART_TOKEN) {
    throw new Error("Britpart env saknas: BRITPART_BASE/BRITPART_TOKEN");
  }
}

export async function safeJson<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`Britpart JSON parse error ${res.status}: ${txt.slice(0, 500)}`);
  }
}

function toAbs(u?: string): string | undefined {
  if (!u) return undefined;
  try { return new URL(u, BRITPART_BASE).toString(); } catch { return undefined; }
}

/* --------------------------------------------------------------- */
/* Lågnivå fetch + parametriserad GET                              */
/* --------------------------------------------------------------- */

export async function britpartFetch(path: string, init?: RequestInit): Promise<Response> {
  ensureConfigured();
  const url = path.startsWith("http")
    ? path
    : `${BRITPART_BASE}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    "Content-Type": "application/json",
    Token: BRITPART_TOKEN,
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        await sleep(400 + attempt * 300);
        continue;
      }
      const body = await res.text();
      throw new Error(`Britpart ${res.status}: ${body.slice(0, 300)}`);
    } catch (e) {
      lastErr = e;
      await sleep(400 + attempt * 300);
    }
  }
  throw lastErr ?? new Error("Britpart call failed");
}

export type BritpartParams = {
  page?: number;
  pageSize?: number;
  code?: string;
  modifiedSince?: string | Date;
  categoryId?: number;
  subcategoryId?: number | string;
};

function qs(params?: BritpartParams) {
  const sp = new URLSearchParams();
  if (!params) return sp;
  if (params.page) sp.set("page", String(params.page));
  if (params.pageSize) sp.set("pageSize", String(params.pageSize));
  if (params.code) sp.set("code", String(params.code));
  if (params.categoryId) sp.set("categoryId", String(params.categoryId));
  if (params.subcategoryId) sp.set("subcategoryId", String(params.subcategoryId));
  if (params.modifiedSince) {
    const iso = typeof params.modifiedSince === "string"
      ? params.modifiedSince
      : (params.modifiedSince as Date).toISOString();
    sp.set("modifiedSince", iso);
  }
  return sp;
}

export async function britpartGet<T>(path: string, params?: BritpartParams): Promise<T> {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${BRITPART_BASE}/api/v1${p}${qs(params).toString() ? `?${qs(params).toString()}` : ""}`;
  const r = await britpartFetch(url, { method: "GET" });
  return safeJson<T>(r);
}

/* --------------------------------------------------------------- */
/* Typer                                                           */
/* --------------------------------------------------------------- */

export type BritpartCategoryResponse = {
  id: number;
  title?: string;
  url?: string;
  partCodes?: string[];
  subcategoryIds?: number[];
  subcategories?: Array<{ id: number; title?: string; partCodes?: string[]; subcategoryIds?: number[] }>;
};

export type GetAllPart = {
  code: string;
  title?: string;
  content?: string;
  subText?: string;
  url?: string;
  imageUrls?: string[];
  datePublished?: string;
  similarParts?: string[];
  categoryIds?: number[];
};

export type GetAllResponse = {
  total: number;
  totalPages: number;
  page: number;
  parts: GetAllPart[];
};

export type BritpartBasic = {
  sku: string;
  title?: string;
  description?: string;   // HTML
  imageUrl?: string;
  imageSource?:
    | "getall.imageUrls[0]"
    | "getall.imageUrls[n]"
    | "api.imageUrl"
    | "api.images[0]"
    | "api.media[0]"
    | "og:image"
    | "twitter:image"
    | "link:image_src"
    | "html:img"
    | "none";
  categoryIds?: number[];
  url?: string;
};

/* --------------------------------------------------------------- */
/* Kategorier + rekursiv kodinsamling                              */
/* --------------------------------------------------------------- */

function normalizeCategory(raw: any): BritpartCategoryResponse {
  const obj = raw?.items ?? raw ?? {};
  return {
    id: Number(obj?.id),
    title: obj?.title,
    url: obj?.url,
    partCodes: Array.isArray(obj?.partCodes) ? obj.partCodes : undefined,
    subcategoryIds: Array.isArray(obj?.subcategoryIds) ? obj.subcategoryIds.map((n: any) => Number(n)) : undefined,
    subcategories: Array.isArray(obj?.subcategories)
      ? obj.subcategories.map((s: any) => ({
          id: Number(s?.id),
          title: s?.title,
          partCodes: Array.isArray(s?.partCodes) ? s.partCodes : undefined,
          subcategoryIds: Array.isArray(s?.subcategoryIds) ? s?.subcategoryIds.map((n: any) => Number(n)) : undefined,
        }))
      : undefined,
  };
}

export async function getCategory(categoryId: number): Promise<BritpartCategoryResponse> {
  // Försök med categoryId, fallback till id
  try {
    return normalizeCategory(await britpartGet<any>("/part/getcategories", { categoryId }));
  } catch {
    const url = `${BRITPART_BASE}/api/v1/part/getcategories?id=${encodeURIComponent(String(categoryId))}`;
    return normalizeCategory(await safeJson(await britpartFetch(url, { method: "GET" })));
  }
}

const catCache = new Map<number, BritpartCategoryResponse>();
export function clearBritpartCategoryCache() { catCache.clear(); }

async function loadCat(id: number): Promise<BritpartCategoryResponse> {
  const cached = catCache.get(id);
  if (cached) return cached;
  const c = await getCategory(id);
  catCache.set(id, c);
  return c;
}

/** Samla partCodes rekursivt från en rotkategori */
async function collectPartCodesFrom(catId: number, seen: Set<number>, depth = 0): Promise<string[]> {
  if (seen.has(catId) || depth > 16) return [];
  seen.add(catId);

  const cat = await loadCat(catId);
  const out: string[] = [];
  if (Array.isArray(cat.partCodes)) out.push(...cat.partCodes);

  const childrenIds = [
    ...(cat.subcategories?.map(s => Number(s.id)) ?? []),
    ...(cat.subcategoryIds ?? []),
  ];

  for (const cid of childrenIds) {
    const child = await loadCat(cid);
    if (Array.isArray(child.partCodes)) out.push(...child.partCodes);
    out.push(...await collectPartCodesFrom(cid, seen, depth + 1));
  }

  return out;
}

export async function britpartGetPartCodesForCategories(categoryIds: number[]): Promise<string[]> {
  clearBritpartCategoryCache();
  const seen = new Set<number>();
  const all: string[] = [];
  for (const id of categoryIds) all.push(...await collectPartCodesFrom(Number(id), seen, 0));
  return Array.from(new Set(all.filter(s => typeof s === "string" && s.trim().length > 0)));
}

/* ---- Leafs (blad) ---------------------------------------------- */

export type LeafInfo = { id: number; title?: string; count: number; sample: string[] };

async function collectLeavesFrom(catId: number, seen: Set<number>, out: Map<number, LeafInfo>, depth = 0) {
  if (seen.has(catId) || depth > 16) return;
  seen.add(catId);

  const cat = await loadCat(catId);

  const codes = Array.isArray(cat.partCodes) ? cat.partCodes : [];
  const childrenIds = [
    ...(cat.subcategories?.map(s => Number(s.id)) ?? []),
    ...(cat.subcategoryIds ?? []),
  ];

  if (codes.length > 0) {
    const prev = out.get(cat.id);
    if (!prev) {
      out.set(cat.id, { id: cat.id, title: cat.title, count: codes.length, sample: codes.slice(0, 5) });
    } else {
      prev.count += codes.length;
      prev.sample = Array.from(new Set([...prev.sample, ...codes])).slice(0, 5);
    }
  }

  for (const childId of childrenIds) await collectLeavesFrom(childId, seen, out, depth + 1);
}

export async function britpartCollectLeaves(categoryIds: number[]): Promise<LeafInfo[]> {
  clearBritpartCategoryCache();
  const seen = new Set<number>();
  const map = new Map<number, LeafInfo>();
  for (const id of categoryIds) await collectLeavesFrom(Number(id), seen, map, 0);
  return Array.from(map.values()).sort((a, b) => a.id - b.id);
}

export async function britpartCollectLeafCodes(categoryIds: number[]): Promise<Map<number, string[]>> {
  clearBritpartCategoryCache();
  const seen = new Set<number>();
  const out = new Map<number, string[]>();

  async function walk(id: number, depth = 0) {
    if (seen.has(id) || depth > 16) return;
    seen.add(id);
    const cat = await loadCat(id);

    if (Array.isArray(cat.partCodes) && cat.partCodes.length) {
      const prev = out.get(cat.id) ?? [];
      const merged = Array.from(new Set([...prev, ...cat.partCodes]));
      out.set(cat.id, merged);
    }

    const kids = [
      ...(cat.subcategories?.map(s => Number(s.id)) ?? []),
      ...(cat.subcategoryIds ?? []),
    ];
    for (const kid of kids) await walk(kid, depth + 1);
  }

  for (const root of categoryIds) await walk(Number(root), 0);
  return out;
}

export async function britpartGetPartCodesForCategoriesFiltered(
  categoryIds: number[],
  onlyLeafIds?: number[]
): Promise<string[]> {
  if (!onlyLeafIds?.length) {
    return britpartGetPartCodesForCategories(categoryIds);
  }
  const map = await britpartCollectLeafCodes(categoryIds);
  const set = new Set<string>();
  for (const id of onlyLeafIds) {
    for (const c of map.get(Number(id)) ?? []) if (c) set.add(String(c));
  }
  return Array.from(set);
}

/* --------------------------------------------------------------- */
/* GetAll + Basic info                                             */
/* --------------------------------------------------------------- */

export async function britpartGetAll(params: BritpartParams): Promise<GetAllResponse> {
  return britpartGet<GetAllResponse>("/part/getall", params);
}

async function basicFromGetAll(code: string): Promise<BritpartBasic> {
  try {
    const r = await britpartGetAll({ code });
    const part =
      (r?.parts || []).find(p => (p.code || "").toLowerCase() === code.toLowerCase()) ||
      (r?.parts || [])[0];

    if (part) {
      const html = [part.content || "", part.subText || ""].filter(Boolean).join("\n");
      const img = Array.isArray(part.imageUrls) && part.imageUrls.length ? part.imageUrls[0] : undefined;
      return {
        sku: code,
        title: part.title || code,
        description: html || undefined,
        imageUrl: img,
        imageSource: img ? "getall.imageUrls[0]" : "none",
        categoryIds: Array.isArray(part.categoryIds) ? part.categoryIds : undefined,
        url: part.url,
      };
    }
  } catch { /* ignore → fallback */ }
  return basicFromFallback(code);
}

/** superenkel fallback: skrapa OG-meta från några tänkbara sidor */
async function fetchOgMeta(url: string): Promise<Partial<BritpartBasic>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const html = await res.text();

    const meta = (prop: string, attr = "property") => {
      const re = new RegExp(`<meta[^>]+${attr}=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
      return re.exec(html)?.[1];
    };
    const link = (rel: string) => {
      const re = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]+href=["']([^"']+)["']`, "i");
      return re.exec(html)?.[1];
    };

    const title = meta("og:title") || meta("twitter:title", "name") || undefined;
    const candidates: (string | undefined)[] = [
      meta("og:image"),
      meta("twitter:image", "name"),
      link("image_src"),
      (/<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1] ?? undefined),
    ];

    const first = candidates.find(Boolean);
    return { title, imageUrl: toAbs(first) };
  } catch { return {}; }
}

async function basicFromFallback(sku: string): Promise<BritpartBasic> {
  const pages = [
    `${BRITPART_BASE}/parts/product/${encodeURIComponent(sku)}`,
    `${BRITPART_BASE}/product/${encodeURIComponent(sku)}`,
    `${BRITPART_BASE}/parts/${encodeURIComponent(sku)}`,
    `${BRITPART_BASE}/products/${encodeURIComponent(sku)}`,
  ];
  for (const u of pages) {
    const meta = await fetchOgMeta(u);
    if (meta.imageUrl || meta.title) {
      return {
        sku,
        title: meta.title ?? sku,
        imageUrl: meta.imageUrl,
        imageSource: meta.imageUrl ? "og:image" : "none",
      };
    }
  }
  return { sku, title: sku, imageSource: "none" };
}

/** Multi: hämta Basinfo för många SKU:er parallellt */
export async function britpartGetBasicForSkus(
  skus: string[],
  concurrency = DEFAULT_CONCURRENCY
): Promise<Record<string, BritpartBasic>> {
  const map: Record<string, BritpartBasic> = {};
  let i = 0;

  async function worker() {
    while (i < skus.length) {
      const idx = i++;
      const sku = skus[idx];
      try {
        map[sku] = await basicFromGetAll(sku);
      } catch {
        map[sku] = { sku, title: sku, imageSource: "none" };
      }
      if (THROTTLE_MS > 0) await sleep(THROTTLE_MS);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, skus.length)) }, worker));
  return map;
}

/* --------------------------------------------------------------- */
/* Bakåtkomp: import helpers                                       */
/* --------------------------------------------------------------- */

export type BritpartImportItem = {
  sku: string;
  name?: string;
  description?: string;
  priceGBP?: number;
  imageUrl?: string;
  categoryId?: number;
};

export async function britpartGetByCategories(categoryIds: number[]): Promise<BritpartImportItem[]> {
  const codes = await britpartGetPartCodesForCategories(categoryIds);
  return codes.map((sku) => ({ sku }));
}
