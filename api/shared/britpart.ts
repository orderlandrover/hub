// api/shared/britpart.ts
import { env } from "./env";

const BRITPART_BASE = env.BRITPART_BASE.replace(/\/$/, ""); // ex https://www.britpart.com
const BRITPART_TOKEN = env.BRITPART_TOKEN;

/** Typen vi använder under rekursionen */
export type BritpartCategoryResponse = {
  id: number;
  title?: string;
  url?: string;
  /** Finns på vissa (blad)kategorier */
  partCodes?: string[];
  /** ID:n till barnkategorier (vanligast på toppnivå/föräldrar) */
  subcategoryIds?: number[];
  /** Ibland får vi inbäddade underkategorier direkt i samma svar */
  subcategories?: Array<{
    id: number;
    title?: string;
    partCodes?: string[];
    subcategoryIds?: number[];
  }>;
};

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

/** liten delay */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** försiktig fetch mot Britpart m. retries på 5xx/429 */
async function britpartFetchRaw(path: string, init?: RequestInit) {
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

      // backoff på 5xx/429
      if (res.status >= 500 || res.status === 429) {
        await sleep(400 + attempt * 300);
        continue;
      }

      throw new Error(`Britpart ${res.status}: ${await res.text()}`);
    } catch (e: any) {
      lastErr = e;
      // nätverksfel → backoff
      await sleep(400 + attempt * 300);
    }
  }
  throw lastErr ?? new Error("Britpart call failed");
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`Britpart JSON parse error ${res.status}: ${txt.slice(0, 300)}`);
  }
}

/* ------------------------------------------------------------------ */
/* publika bas-anrop                                                   */
/* ------------------------------------------------------------------ */

export async function getCategory(id: number): Promise<BritpartCategoryResponse> {
  const res = await britpartFetchRaw(`/part/getcategories?id=${id}`);
  return safeJson<BritpartCategoryResponse>(res);
}

/** Roten (id=3 "All Parts") för att få ut top-nivåns subkategorier till UI */
export async function getRootCategories(): Promise<BritpartCategoryResponse> {
  const res = await britpartFetchRaw(`/part/getcategories?id=3`);
  return safeJson<BritpartCategoryResponse>(res);
}

/* ------------------------------------------------------------------ */
/* rekursiv insamling av partCodes                                     */
/* ------------------------------------------------------------------ */

/** enkel cache så vi inte hämtar samma kategori om och om igen */
const catCache = new Map<number, BritpartCategoryResponse>();

/**
 * Hämtar alla partCodes för EN kategori, rekursivt.
 * - Läser `partCodes` direkt om de finns
 * - Annars följer vi `subcategories` och/eller `subcategoryIds`
 */
async function collectPartCodesFrom(
  catId: number,
  seen: Set<number>,
  depth: number = 0
): Promise<string[]> {
  if (seen.has(catId)) return [];
  seen.add(catId);

  // skydda oss mot orimligt djupa träd
  if (depth > 12) return [];

  let cat = catCache.get(catId);
  if (!cat) {
    cat = await getCategory(catId);
    catCache.set(catId, cat);
  }

  const out: string[] = [];

  // 1) egna koder
  if (Array.isArray(cat.partCodes) && cat.partCodes.length) {
    out.push(...cat.partCodes);
  }

  // 2) inbäddade subcategories i samma svar
  if (Array.isArray(cat.subcategories) && cat.subcategories.length) {
    for (const sc of cat.subcategories) {
      if (Array.isArray(sc.partCodes) && sc.partCodes.length) {
        out.push(...sc.partCodes);
      }
      if (Array.isArray(sc.subcategoryIds) && sc.subcategoryIds.length) {
        for (const subId of sc.subcategoryIds) {
          const inner = await collectPartCodesFrom(Number(subId), seen, depth + 1);
          out.push(...inner);
        }
      }
    }
  }

  // 3) bara ID-lista → gå vidare rekursivt
  if (Array.isArray(cat.subcategoryIds) && cat.subcategoryIds.length) {
    for (const subId of cat.subcategoryIds) {
      const inner = await collectPartCodesFrom(Number(subId), seen, depth + 1);
      out.push(...inner);
    }
  }

  return out;
}

/**
 * Publik funktion:
 * - Tar en eller flera kategori‑ID:n (top eller mellan‑nivå)
 * - Returnerar **unika** partCodes från alla underliggande blad
 */
export async function britpartGetPartCodesForCategories(
  categoryIds: number[]
): Promise<string[]> {
  const seen = new Set<number>();
  const all: string[] = [];

  for (const id of categoryIds) {
    const codes = await collectPartCodesFrom(Number(id), seen, 0);
    all.push(...codes);
  }

  // unika & filtrerade på rimlig sträng
  return Array.from(
    new Set(all.filter((s) => typeof s === "string" && s.trim().length > 0))
  );
}