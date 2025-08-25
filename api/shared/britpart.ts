// api/shared/britpart.ts
import { env } from "./env";

/**
 * Bas-URL och token. BRITPART_BASE kan t.ex. vara "https://www.britpart.com"
 * Vi trimmar trailing slash för att undvika dubbel-/
 */
const BRITPART_BASE = env.BRITPART_BASE.replace(/\/$/, "");
const BRITPART_TOKEN = env.BRITPART_TOKEN;

/* ------------------------------------------------------------------ */
/* Typer                                                               */
/* ------------------------------------------------------------------ */

/**
 * Typen vi använder internt efter normalisering.
 * OBS: Britpart kan returnera olika former (ibland under "items"),
 * därför normaliserar vi alltid via normalizeCategory().
 */
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

/** säkert JSON‑parse med förbättrat felmeddelande */
async function safeJson<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(
      `Britpart JSON parse error ${res.status}: ${txt.slice(0, 300)}`
    );
  }
}

/**
 * Normalisera Britpart-svar:
 * - Vissa endpoints svarar som { items: {...} }, andra som {...}
 * - Säkrar att id/ids är number
 */
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
      ? obj.subcategoryIds.map((n: any) => Number(n))
      : undefined,
    subcategories: normSubcats,
  };
}

/** försiktig fetch mot Britpart m. retries/backoff på 5xx/429 + nätverksfel */
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

      // annan status = "hårt" fel
      const body = await res.text();
      throw new Error(`Britpart ${res.status}: ${body}`);
    } catch (e: any) {
      lastErr = e;
      // nätverksfel → backoff och nytt försök
      await sleep(400 + attempt * 300);
    }
  }
  throw lastErr ?? new Error("Britpart call failed");
}

/* ------------------------------------------------------------------ */
/* publika bas-anrop                                                   */
/* ------------------------------------------------------------------ */

/** Hämta valfri kategori */
export async function getCategory(id: number): Promise<BritpartCategoryResponse> {
  const res = await britpartFetchRaw(`/part/getcategories?id=${id}`);
  const json = await safeJson(res);
  return normalizeCategory(json);
}

/** Roten (id=3 "All Parts") för att få ut top-nivåns subkategorier till UI */
export async function getRootCategories(): Promise<BritpartCategoryResponse> {
  const res = await britpartFetchRaw(`/part/getcategories?id=3`);
  const json = await safeJson(res);
  return normalizeCategory(json);
}

/**
 * Hämta endast DIREKTA barn (bra för UI‑listor där man klickar sig ner)
 * Returnerar en lista av normaliserade child‑noder.
 */
export async function getDirectSubcategories(
  parentId: number
): Promise<BritpartCategoryResponse["subcategories"]> {
  const parent = await getCategory(parentId);
  // Om svaret inte embed:ade barn, och vi bara fick subcategoryIds,
  // kan man välja att hämta in dessa parallellt. Här håller vi oss snabba
  // och returnerar det som fanns i svaret – UI kan sedan ropa getCategory(childId)
  // vid expandering.
  return parent.subcategories ?? [];
}

/* ------------------------------------------------------------------ */
/* rekursiv insamling av partCodes                                     */
/* ------------------------------------------------------------------ */

/** enkel cache så vi inte hämtar samma kategori om och om igen */
const catCache = new Map<number, BritpartCategoryResponse>();

/**
 * Hämtar alla partCodes för EN kategori, rekursivt.
 * Strategi:
 *  - Läs egna `partCodes` om de finns
 *  - Gå igenom inbäddade `subcategories`:
 *      * push:a deras `partCodes` (om finns)
 *      * REKURSA ALLTID på deras `id` (viktigt!)
 *      * (om en subcategory dessutom innehåller `subcategoryIds` i samma svar,
 *         följ även dem – ofarligt och ibland snabbare)
 *  - Gå igenom `subcategoryIds` på kategorin och rekursa
 */
async function collectPartCodesFrom(
  catId: number,
  seen: Set<number>,
  depth: number = 0
): Promise<string[]> {
  if (seen.has(catId)) return [];
  seen.add(catId);

  // skydda oss mot orimligt djupa/länkade träd
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

      // Viktigt: rekursa alltid på barnets id (kan sakna subcategoryIds i samma svar)
      const innerFromChild = await collectPartCodesFrom(Number(sc.id), seen, depth + 1);
      out.push(...innerFromChild);

      // (valfritt men ofarligt): om svaret även innehåller en ID-lista, följ även den
      if (Array.isArray(sc.subcategoryIds) && sc.subcategoryIds.length) {
        for (const subId of sc.subcategoryIds) {
          const inner = await collectPartCodesFrom(Number(subId), seen, depth + 1);
          out.push(...inner);
        }
      }
    }
  }

  // 3) endast ID-lista på denna nivå → gå vidare rekursivt
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
 *  - Tar en eller flera kategori‑ID:n (top eller mellan‑nivå)
 *  - Returnerar **unika** partCodes från alla underliggande blad
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