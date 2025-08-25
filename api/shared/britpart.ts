// api/shared/britpart.ts
import { env } from "./env";

const BRITPART_BASE = env.BRITPART_BASE.replace(/\/$/, ""); // t.ex. https://www.britpart.com
const BRITPART_TOKEN = env.BRITPART_TOKEN;

export type BritpartCategoryResponse = {
  id: number;
  title?: string;
  url?: string;
  partCodes?: string[];            // Finns på bladkategorier
  subcategoryIds?: number[];       // Finns på föräldrakategorier
  subcategories?: Array<{          // Ibland kommer inbäddade barn
    id: number;
    title?: string;
    partCodes?: string[];
    subcategoryIds?: number[];
  }>;
};

async function safeJson<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try { return JSON.parse(txt) as T; }
  catch { throw new Error(`Britpart JSON parse error ${res.status}: ${txt.slice(0, 300)}`); }
}

/** Basfetch mot Britpart API v1 (lägger på /api/v1 och Token-header). */
export async function britpartFetch(path: string, init?: RequestInit) {
  const url = path.startsWith("http")
    ? path
    : `${BRITPART_BASE}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    Token: BRITPART_TOKEN,
  };

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Britpart ${url} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

/** Hämta EN kategori (förälder eller blad) – korrekt param är categoryId. */
export async function getCategory(categoryId: number): Promise<BritpartCategoryResponse> {
  const res = await britpartFetch(`/part/getcategories?categoryId=${encodeURIComponent(categoryId)}`);
  return safeJson<BritpartCategoryResponse>(res);
}

/** Hämta top‑level underkategorier (dvs barn till All Parts id=3) som {id,name}. */
export async function getRootCategories(): Promise<Array<{ id: number; name: string }>> {
  const res = await britpartFetch("/part/getcategories?categoryId=3");
  const data = await safeJson<BritpartCategoryResponse>(res);

  const subs = Array.isArray((data as any).subcategories) ? (data as any).subcategories : [];
  return subs.map((s: any) => ({
    id: Number(s.id),
    name: String(s.title ?? s.name ?? "").trim(),
  }));
}

/** Cache för att undvika upprepade hämtningar i rekursionen. */
const catCache = new Map<number, BritpartCategoryResponse>();

/** Rekursivt samla partCodes för EN kategori. */
async function collectPartCodesFrom(catId: number, seen: Set<number>): Promise<string[]> {
  if (seen.has(catId)) return [];
  seen.add(catId);

  let cat = catCache.get(catId);
  if (!cat) {
    cat = await getCategory(catId);
    catCache.set(catId, cat);
  }

  const out: string[] = [];

  // 1) egna koder
  if (Array.isArray(cat.partCodes) && cat.partCodes.length) out.push(...cat.partCodes);

  // 2) inbäddade subcategories (om de råkar finnas)
  if (Array.isArray(cat.subcategories) && cat.subcategories.length) {
    for (const sc of cat.subcategories) {
      if (Array.isArray(sc.partCodes) && sc.partCodes.length) out.push(...sc.partCodes);
      if (Array.isArray(sc.subcategoryIds) && sc.subcategoryIds.length) {
        for (const subId of sc.subcategoryIds) {
          out.push(...(await collectPartCodesFrom(Number(subId), seen)));
        }
      }
    }
  }

  // 3) länkar till barns id:n
  if (Array.isArray(cat.subcategoryIds) && cat.subcategoryIds.length) {
    for (const subId of cat.subcategoryIds) {
      out.push(...(await collectPartCodesFrom(Number(subId), seen)));
    }
  }

  return out;
}

/** Publik: hämta alla partCodes (unika) för en lista med kategori‑ID:n. */
export async function britpartGetPartCodesForCategories(categoryIds: number[]): Promise<string[]> {
  const seen = new Set<number>();
  const acc: string[] = [];
  for (const id of categoryIds) acc.push(...(await collectPartCodesFrom(Number(id), seen)));
  return Array.from(new Set(acc));
}