// api/shared/britpart.ts
import { env } from "./env";

const BRITPART_BASE = env.BRITPART_BASE.replace(/\/$/, ""); // t.ex. https://www.britpart.com
const BRITPART_TOKEN = env.BRITPART_TOKEN;

export type BritpartCategoryResponse = {
  id: number;
  title?: string;
  url?: string;
  /** Finns på bladkategorier */
  partCodes?: string[];
  /** Finns på föräldrakategorier */
  subcategoryIds?: number[];
  /** Ibland skickar API:et även inbäddade subkategorier */
  subcategories?: Array<{
    id: number;
    title?: string;
    partCodes?: string[];
    subcategoryIds?: number[];
  }>;
};

/** Liten helper för try/catch + text fallback vid felsvar */
async function safeJson(res: Response) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`Britpart JSON parse error ${res.status}: ${txt.slice(0, 300)}`);
  }
}

/** Bas-fetch mot Britpart API */
export async function britpartFetch(path: string, init?: RequestInit) {
  const url =
    path.startsWith("http")
      ? path
      : `${BRITPART_BASE.replace(/\/$/, "")}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    "Content-Type": "application/json",
    Token: BRITPART_TOKEN,
  };

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Britpart ${url} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

/** Hämtar EN kategori (kan vara förälder eller blad) */
export async function getCategory(id: number): Promise<BritpartCategoryResponse> {
  const res = await britpartFetch(`/part/getcategories?id=${id}`);
  return safeJson(res) as Promise<BritpartCategoryResponse>;
}

/** Hämtar alla top-level subkategorier (för UI-listan) */
export async function getTopSubcategories(): Promise<Array<{ id: number; name: string }>> {
  // All Parts => id 3 innehåller top-level subcategories
  const res = await britpartFetch("/part/getcategories?id=3");
  const data = (await safeJson(res)) as BritpartCategoryResponse;

  const items =
    data.subcategories?.map((s) => ({ id: s.id, name: s.title ?? String(s.id) })) ?? [];

  return items;
}

/** Cache så vi inte slår samma kategori flera gånger i rekursionen */
const catCache = new Map<number, BritpartCategoryResponse>();

/** Hämta partCodes rekursivt för EN kategori-id */
async function collectPartCodesFrom(catId: number, seen: Set<number>): Promise<string[]> {
  if (seen.has(catId)) return [];
  seen.add(catId);

  let cat = catCache.get(catId);
  if (!cat) {
    cat = await getCategory(catId);
    catCache.set(catId, cat);
  }

  const codes: string[] = [];

  // 1) Om denna kategori har egna partCodes -> använd dem
  if (Array.isArray(cat.partCodes) && cat.partCodes.length) {
    codes.push(...cat.partCodes);
  }

  // 2) Om den har inbäddade subcategories -> kolla dem
  if (Array.isArray(cat.subcategories) && cat.subcategories.length) {
    for (const sc of cat.subcategories) {
      if (Array.isArray(sc.partCodes) && sc.partCodes.length) {
        codes.push(...sc.partCodes);
      }
      // subcategories kan i vissa svar också ha egna subcategoryIds
      if (Array.isArray(sc.subcategoryIds) && sc.subcategoryIds.length) {
        for (const subId of sc.subcategoryIds) {
          const inner = await collectPartCodesFrom(subId, seen);
          codes.push(...inner);
        }
      }
    }
  }

  // 3) Om den har subcategoryIds -> gå rekursivt
  if (Array.isArray(cat.subcategoryIds) && cat.subcategoryIds.length) {
    for (const subId of cat.subcategoryIds) {
      const inner = await collectPartCodesFrom(subId, seen);
      codes.push(...inner);
    }
  }

  return codes;
}

/**
 * Publik funktion: ge mig ALLA partCodes för EN eller FLERA kategorier (rekursivt).
 * Returnerar unika koder (case-sensitivt).
 */
export async function britpartGetPartCodesForCategories(categoryIds: number[]): Promise<string[]> {
  const seen = new Set<number>();
  const codes: string[] = [];

  for (const id of categoryIds) {
    const c = await collectPartCodesFrom(Number(id), seen);
    codes.push(...c);
  }

  // unika
  return Array.from(new Set(codes));
}