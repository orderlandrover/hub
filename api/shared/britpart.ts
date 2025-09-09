// api/shared/britpart.ts
import { env } from "./env";

/** Bas och token */
const BRITPART_BASE = (env.BRITPART_BASE || "").replace(/\/+$/, "");
const BRITPART_TOKEN = env.BRITPART_TOKEN || "";

/* ----------------------------- Typer ----------------------------- */

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

/** Data vi exponerar uppåt */
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
  /** Nytt: för debugging/filtrering */
  categoryIds?: number[];
  url?: string;
};

/** GetAll-schema (sammandrag) */
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

/* ----------------------------- Helpers ----------------------------- */

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
    throw new Error(`Britpart JSON parse error ${res.status}: ${txt.slice(0, 300)}`);
  }
}

function toAbs(u?: string): string | undefined {
  if (!u) return undefined;
  try { return new URL(u, BRITPART_BASE).toString(); } catch { return undefined; }
}

/* ----------------------------- Lågnivå fetch ----------------------------- */

async function britpartFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  ensureConfigured();
  const url = path.startsWith("http")
    ? path
    : `${BRITPART_BASE}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    "Content-Type": "application/json",
    Token: BRITPART_TOKEN,  // token i header
  };

  let lastErr: any;
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

export { britpartFetchRaw as britpartFetch };

/* ----------------------------- Kategorier ----------------------------- */

function normalizeCategory(raw: any): BritpartCategoryResponse {
  const obj = raw?.items ?? raw ?? {};
  const normSubcats: BritpartCategoryResponse["subcategories"] =
    Array.isArray(obj.subcategories)
      ? obj.subcategories.map((s: any) => ({
          id: Number(s?.id),
          title: s?.title,
          partCodes: Array.isArray(s?.partCodes) ? s.partCodes : undefined,
          subcategoryIds: Array.isArray(s?.subcategoryIds)
            ? s?.subcategoryIds.map((n: any) => Number(n))
            : undefined,
        }))
      : undefined;

  return {
    id: Number(obj?.id),
    title: obj?.title,
    url: obj?.url,
    partCodes: Array.isArray(obj?.partCodes) ? obj.partCodes : undefined,
    subcategoryIds: Array.isArray(obj?.subcategoryIds)
      ? obj?.subcategoryIds.map((n: any) => Number(n))
      : undefined,
    subcategories: normSubcats,
  };
}

export async function getCategory(categoryId: number): Promise<BritpartCategoryResponse> {
  const tryOne = async (param: "id" | "categoryId") => {
    const res = await britpartFetchRaw(`/part/getcategories?${param}=${Number(categoryId)}`);
    const json = await safeJson(res);
    return normalizeCategory(json);
  };
  // Viktigt: börja med categoryId; om backend ignorerar "id" men svarar 200 blir det fel.
  try { return await tryOne("categoryId"); } catch { return await tryOne("id"); }
}

export async function getDirectSubcategories(
  parentId: number
): Promise<BritpartCategoryResponse["subcategories"]> {
  const parent = await getCategory(parentId);
  return parent.subcategories ?? [];
}

/* ----------------------------- Rekursiv kodinsamling ----------------------------- */

const catCache = new Map<number, BritpartCategoryResponse>();
export function clearBritpartCategoryCache() { catCache.clear(); }

async function loadCat(id: number): Promise<BritpartCategoryResponse> {
  const cached = catCache.get(id);
  if (cached) return cached;
  const c = await getCategory(id);
  catCache.set(id, c);
  return c;
}

/** Samla alla partCodes som ligger under en kategori (rekursivt). */
async function collectPartCodesFrom(
  catId: number, seen: Set<number>, depth = 0
): Promise<string[]> {
  if (seen.has(catId)) return [];
  seen.add(catId);
  if (depth > 16) return [];

  const cat = await loadCat(catId);

  const out: string[] = [];
  if (Array.isArray(cat.partCodes)) out.push(...cat.partCodes);

  // Rekurs över inbäddade subcategories
  if (Array.isArray(cat.subcategories)) {
    for (const sc of cat.subcategories) {
      if (Array.isArray(sc.partCodes)) out.push(...sc.partCodes);
      out.push(...await collectPartCodesFrom(Number(sc.id), seen, depth + 1));
      if (Array.isArray(sc.subcategoryIds)) {
        for (const subId of sc.subcategoryIds) {
          out.push(...await collectPartCodesFrom(Number(subId), seen, depth + 1));
        }
      }
    }
  }

  // Och över “länkat” id-fält
  if (Array.isArray(cat.subcategoryIds)) {
    for (const subId of cat.subcategoryIds) {
      out.push(...await collectPartCodesFrom(Number(subId), seen, depth + 1));
    }
  }

  return out;
}

export async function britpartGetPartCodesForCategories(categoryIds: number[]): Promise<string[]> {
  clearBritpartCategoryCache();
  const seen = new Set<number>();
  const all: string[] = [];
  for (const id of categoryIds) all.push(...await collectPartCodesFrom(Number(id), seen, 0));
  return Array.from(new Set(all.filter((s) => typeof s === "string" && s.trim().length > 0)));
}

/* --------- Hjälpare: hitta “blad” (kategorier som faktiskt har partCodes) -------- */

export type LeafInfo = { id: number; title?: string; count: number; sample: string[] };

async function collectLeavesFrom(catId: number, seen: Set<number>, out: Map<number, LeafInfo>, depth = 0) {
  if (seen.has(catId)) return;
  seen.add(catId);
  if (depth > 16) return;

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
      // om samma blad råkar dyka upp flera gånger, summera
      prev.count += codes.length;
      prev.sample = Array.from(new Set([...prev.sample, ...codes])).slice(0, 5);
    }
  }

  for (const childId of childrenIds) {
    await collectLeavesFrom(childId, seen, out, depth + 1);
  }
}

export async function britpartCollectLeaves(categoryIds: number[]): Promise<LeafInfo[]> {
  clearBritpartCategoryCache();
  const seen = new Set<number>();
  const map = new Map<number, LeafInfo>();
  for (const id of categoryIds) {
    await collectLeavesFrom(Number(id), seen, map, 0);
  }
  return Array.from(map.values()).sort((a, b) => a.id - b.id);
}

/* ----------------------------- GET /part/getall ----------------------------- */

export async function britpartGetAll(params: {
  page?: number;
  code?: string;
  modifiedSince?: string | Date;
}): Promise<GetAllResponse> {
  const usp = new URLSearchParams();
  if (params.page) usp.set("page", String(params.page));
  if (params.code) usp.set("code", String(params.code));
  if (params.modifiedSince) {
    const iso = typeof params.modifiedSince === "string"
      ? params.modifiedSince
      : (params.modifiedSince as Date).toISOString();
    usp.set("modifiedSince", iso);
  }
  const res = await britpartFetchRaw(`/part/getall?${usp.toString()}`);
  return safeJson<GetAllResponse>(res);
}

/** Hämta titel/bild/description för EN SKU via GetAll, med fallback. */
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
  } catch {
    // gå vidare till fallback
  }
  return await basicFromFallback(code);
}

/* ----------------------------- Fallback (öppna sidan) ----------------------------- */

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
  } catch {
    return {};
  }
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

/* ----------------------------- Multi ----------------------------- */

export async function britpartGetBasicForSkus(
  skus: string[],
  concurrency = 10
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
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, skus.length)) }, worker)
  );
  return map;
}

/* ----------------------------- Bakåtkomp ----------------------------- */

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
