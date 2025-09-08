// api/shared/britpart.ts
import { env } from "./env";

/**
 * ENV:
 *  - BRITPART_BASE  (ex: https://www.britpart.com) – ingen slash på slutet
 *  - BRITPART_TOKEN (API-nyckel)
 */
const BRITPART_BASE = (env.BRITPART_BASE || "").replace(/\/+$/, "");
const BRITPART_TOKEN = env.BRITPART_TOKEN || "";

/* ------------------------------------------------------------------ */
/* Typer                                                               */
/* ------------------------------------------------------------------ */

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

export type BritpartBasic = {
  sku: string;
  title?: string;
  description?: string;
  imageUrl?: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ensureBaseConfigured() {
  if (!BRITPART_BASE || !BRITPART_TOKEN) {
    throw new Error("Britpart env saknas: BRITPART_BASE/BRITPART_TOKEN");
  }
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`Britpart JSON parse error ${res.status}: ${txt.slice(0, 300)}`);
  }
}

function normalizeCategory(raw: any): BritpartCategoryResponse {
  const obj = raw?.items ?? raw ?? {};

  const normSubcats: BritpartCategoryResponse["subcategories"] =
    Array.isArray(obj.subcategories)
      ? obj.subcategories.map((s: any) => ({
          id: Number(s?.id),
          title: s?.title,
          partCodes: Array.isArray(s?.partCodes) ? s.partCodes : undefined,
          subcategoryIds: Array.isArray(s?.subcategoryIds)
            ? s.subcategoryIds.map((n: any) => Number(n))
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

/* ------------------------------------------------------------------ */
/* Lågnivå fetch (Token-header + backoff)                              */
/* ------------------------------------------------------------------ */

async function britpartFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  ensureBaseConfigured();

  const url = path.startsWith("http")
    ? path
    : `${BRITPART_BASE}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    "Content-Type": "application/json",
    Token: BRITPART_TOKEN,
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

// Bakåtkompatibelt exportnamn om andra functions importerar detta
export { britpartFetchRaw as britpartFetch };

/* ------------------------------------------------------------------ */
/* Kategorier                                                          */
/* ------------------------------------------------------------------ */

/** Prova först ?id=, sedan ?categoryId= (olika miljöer förväntar olika) */
export async function getCategory(categoryId: number): Promise<BritpartCategoryResponse> {
  const tryOne = async (param: "id" | "categoryId") => {
    const res = await britpartFetchRaw(`/part/getcategories?${param}=${Number(categoryId)}`);
    const json = await safeJson(res);
    return normalizeCategory(json);
  };
  try {
    return await tryOne("id");
  } catch {
    return await tryOne("categoryId");
  }
}

/** Roten (3 = All Parts) */
export async function getRootCategories(): Promise<BritpartCategoryResponse> {
  return getCategory(3);
}

export async function getDirectSubcategories(
  parentId: number
): Promise<BritpartCategoryResponse["subcategories"]> {
  const parent = await getCategory(parentId);
  return parent.subcategories ?? [];
}

/* ------------------------------------------------------------------ */
/* Rekursiv traversal för partCodes                                    */
/* ------------------------------------------------------------------ */

const catCache = new Map<number, BritpartCategoryResponse>();

async function collectPartCodesFrom(
  catId: number,
  seen: Set<number>,
  depth: number = 0
): Promise<string[]> {
  if (seen.has(catId)) return [];
  seen.add(catId);
  if (depth > 12) return [];

  let cat = catCache.get(catId);
  if (!cat) {
    cat = await getCategory(catId);
    catCache.set(catId, cat);
  }

  const out: string[] = [];

  if (Array.isArray(cat.partCodes) && cat.partCodes.length) out.push(...cat.partCodes);

  if (Array.isArray(cat.subcategories) && cat.subcategories.length) {
    for (const sc of cat.subcategories) {
      if (Array.isArray(sc.partCodes) && sc.partCodes.length) out.push(...sc.partCodes);

      const innerFromChild = await collectPartCodesFrom(Number(sc.id), seen, depth + 1);
      out.push(...innerFromChild);

      if (Array.isArray(sc.subcategoryIds) && sc.subcategoryIds.length) {
        for (const subId of sc.subcategoryIds) {
          const inner = await collectPartCodesFrom(Number(subId), seen, depth + 1);
          out.push(...inner);
        }
      }
    }
  }

  if (Array.isArray(cat.subcategoryIds) && cat.subcategoryIds.length) {
    for (const subId of cat.subcategoryIds) {
      const inner = await collectPartCodesFrom(Number(subId), seen, depth + 1);
      out.push(...inner);
    }
  }

  return out;
}

export async function britpartGetPartCodesForCategories(categoryIds: number[]): Promise<string[]> {
  const seen = new Set<number>();
  const all: string[] = [];
  for (const id of categoryIds) {
    const codes = await collectPartCodesFrom(Number(id), seen, 0);
    all.push(...codes);
  }
  return Array.from(new Set(all.filter((s) => typeof s === "string" && s.trim().length > 0)));
}

/* ------------------------------------------------------------------ */
/* Titel & bild per SKU (API → fallback: og:image)                     */
/* ------------------------------------------------------------------ */

async function fetchOgMeta(url: string): Promise<Partial<BritpartBasic>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const html = await res.text();

    const find = (prop: string) => {
      const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
      return re.exec(html)?.[1];
    };

    return {
      title: find("og:title"),
      imageUrl: find("og:image"),
    };
  } catch {
    return {};
  }
}

/** Prova kända API-endpoints; om de inte finns → använd produktsidans og:image */
async function getOneBasicForSku(sku: string): Promise<BritpartBasic> {
  const candidates = [
    `/part/getproduct?code=${encodeURIComponent(sku)}`,
    `/part/get?code=${encodeURIComponent(sku)}`,
  ];

  for (const path of candidates) {
    try {
      const res = await britpartFetchRaw(path);
      if (!res.ok) continue;
      const data = await (res.json() as Promise<any>).catch(() => null);
      if (!data) continue;

      const obj = data.items ?? data;
      const title = obj?.title ?? obj?.name ?? undefined;
      const imageUrl =
        obj?.imageUrl ??
        obj?.image?.url ??
        obj?.images?.[0]?.url ??
        obj?.media?.[0]?.src ??
        undefined;
      const description = obj?.description ?? undefined;

      if (title || imageUrl || description) {
        return { sku, title, description, imageUrl };
      }
    } catch {
      // prova nästa
    }
  }

  // Fallback – publik produktsida
  const pageUrl = `${BRITPART_BASE}/parts/product/${encodeURIComponent(sku)}`;
  const meta = await fetchOgMeta(pageUrl);
  return { sku, title: meta.title ?? sku, imageUrl: meta.imageUrl };
}

export async function britpartGetBasicForSkus(
  skus: string[],
  concurrency = 8
): Promise<Record<string, BritpartBasic>> {
  const map: Record<string, BritpartBasic> = {};
  let i = 0;

  async function worker() {
    while (i < skus.length) {
      const idx = i++;
      const sku = skus[idx];
      try {
        map[sku] = await getOneBasicForSku(sku);
      } catch {
        map[sku] = { sku };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, skus.length)) }, worker)
  );

  return map;
}

/* ------------------------------------------------------------------ */
/* Bakåtkompatibel hjälpare                                           */
/* ------------------------------------------------------------------ */

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
