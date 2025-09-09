// api/shared/britpart.ts
import { env } from "./env";

/** Bas och token */
const BRITPART_BASE = (env.BRITPART_BASE || "").replace(/\/+$/, "");
const BRITPART_TOKEN = env.BRITPART_TOKEN || "";

/* --------------------------------------------------------------- */
/* Typer                                                           */
/* --------------------------------------------------------------- */

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

/** Data vi exponerar uppåt (titel/bild/description + källa) */
export type BritpartBasic = {
  sku: string;
  title?: string;
  description?: string;        // HTML från Britpart (content + ev. subText)
  imageUrl?: string;           // presigned S3-URL eller absolut http(s)
  url?: string;                // publika produktsidan hos Britpart (om känd)
  categoryIds?: number[];      // <-- NYTT: för probe / kontroll
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
};

/** GetAll-schema (sammandrag) enligt deras docs */
export type GetAllPart = {
  code: string;
  title?: string;
  content?: string;        // HTML
  subText?: string;        // HTML
  url?: string;
  imageUrls?: string[];    // presigned S3 eller publika
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

/* --------------------------------------------------------------- */
/* Helpers                                                         */
/* --------------------------------------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ensureConfigured() {
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

function toAbs(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u, BRITPART_BASE).toString();
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------------- */
/* Lågnivå fetch med backoff                                       */
/* --------------------------------------------------------------- */

async function britpartFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  ensureConfigured();
  const url = path.startsWith("http")
    ? path
    : `${BRITPART_BASE}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    "Content-Type": "application/json",
    Token: BRITPART_TOKEN, // token via header
  };

  let lastErr: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.ok) return res;

      if (res.status === 429 || res.status >= 500) {
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

/** Exporteras ibland separat */
export { britpartFetchRaw as britpartFetch };

/* --------------------------------------------------------------- */
/* Kategorier                                                      */
/* --------------------------------------------------------------- */

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
  try {
    return await tryOne("id");
  } catch {
    return await tryOne("categoryId");
  }
}

export async function getRootCategories(): Promise<BritpartCategoryResponse> {
  return getCategory(3);
}

export async function getDirectSubcategories(
  parentId: number
): Promise<BritpartCategoryResponse["subcategories"]> {
  const parent = await getCategory(parentId);
  return parent.subcategories ?? [];
}

/* --------------------------------------------------------------- */
/* Part codes (rekursivt)                                          */
/* --------------------------------------------------------------- */

const catCache = new Map<number, BritpartCategoryResponse>();

async function collectPartCodesFrom(
  catId: number,
  seen: Set<number>,
  depth = 0
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
  if (Array.isArray(cat.partCodes)) out.push(...cat.partCodes);

  if (Array.isArray(cat.subcategories)) {
    for (const sc of cat.subcategories) {
      if (Array.isArray(sc.partCodes)) out.push(...sc.partCodes);
      out.push(...(await collectPartCodesFrom(Number(sc.id), seen, depth + 1)));
      if (Array.isArray(sc.subcategoryIds)) {
        for (const subId of sc.subcategoryIds) {
          out.push(...(await collectPartCodesFrom(Number(subId), seen, depth + 1)));
        }
      }
    }
  }

  if (Array.isArray(cat.subcategoryIds)) {
    for (const subId of cat.subcategoryIds) {
      out.push(...(await collectPartCodesFrom(Number(subId), seen, depth + 1)));
    }
  }

  return out;
}

export async function britpartGetPartCodesForCategories(categoryIds: number[]): Promise<string[]> {
  const seen = new Set<number>();
  const all: string[] = [];
  for (const id of categoryIds) {
    all.push(...(await collectPartCodesFrom(Number(id), seen, 0)));
  }
  return Array.from(new Set(all.filter((s) => typeof s === "string" && s.trim().length > 0)));
}

/* --------------------------------------------------------------- */
/* GET /part/getall                                                */
/* --------------------------------------------------------------- */

/** GetAll enligt dokumentationen (code = exakt part code / sök) */
export async function britpartGetAll(params: {
  page?: number;
  code?: string;                  // exakt SKU (kan vara “sök” hos Britpart)
  modifiedSince?: string | Date;  // ISO 8601
}): Promise<GetAllResponse> {
  const usp = new URLSearchParams();
  if (params.page) usp.set("page", String(params.page));
  if (params.code) usp.set("code", String(params.code));
  if (params.modifiedSince) {
    const iso =
      typeof params.modifiedSince === "string"
        ? params.modifiedSince
        : (params.modifiedSince as Date).toISOString();
    usp.set("modifiedSince", iso);
  }
  // token via header; (de accepterar även query-param, men header är redan satt)
  const res = await britpartFetchRaw(`/part/getall?${usp.toString()}`);
  return safeJson<GetAllResponse>(res);
}

/** Hämta titel/bild/description för EN SKU via GetAll, med fallback. */
async function basicFromGetAll(code: string): Promise<BritpartBasic> {
  try {
    const r = await britpartGetAll({ code }); // filtrerat på SKU
    const parts = Array.isArray(r?.parts) ? r.parts : [];
    const exact =
      parts.find((p) => (p.code || "").toLowerCase() === code.toLowerCase()) || parts[0];

    if (exact) {
      const html = [exact.content || "", exact.subText || ""]
        .filter(Boolean)
        .join("\n")
        .trim();

      const firstImg =
        Array.isArray(exact.imageUrls) && exact.imageUrls.length ? exact.imageUrls[0] : undefined;

      return {
        sku: code,
        title: exact.title || code,
        description: html || undefined,
        imageUrl: firstImg,
        url: exact.url,
        categoryIds: Array.isArray(exact.categoryIds)
          ? exact.categoryIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
          : undefined,
        imageSource: firstImg ? "getall.imageUrls[0]" : "none",
      };
    }
  } catch {
    // Ignorera och prova fallback
  }
  return await basicFromFallback(code);
}

/* --------------------------------------------------------------- */
/* Fallback: publik sida (og:image / twitter / link / img)         */
/* --------------------------------------------------------------- */

type OgPick =
  | { imageUrl?: string; title?: string; source?: BritpartBasic["imageSource"] }
  | {};

async function fetchOgMeta(url: string): Promise<OgPick> {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const html = await res.text();

    const pickMeta = (prop: string, attr = "property") => {
      const re = new RegExp(
        `<meta[^>]+${attr}=["']${prop}["'][^>]+content=["']([^"']+)["']`,
        "i"
      );
      return re.exec(html)?.[1];
    };
    const pickLink = (rel: string) => {
      const re = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]+href=["']([^"']+)["']`, "i");
      return re.exec(html)?.[1];
    };
    const title =
      pickMeta("og:title") || pickMeta("twitter:title", "name") || undefined;

    // prio-ordning och källa
    const og = pickMeta("og:image");
    if (og) return { title, imageUrl: toAbs(og), source: "og:image" };

    const tw = pickMeta("twitter:image", "name");
    if (tw) return { title, imageUrl: toAbs(tw), source: "twitter:image" };

    const linkImg = pickLink("image_src");
    if (linkImg) return { title, imageUrl: toAbs(linkImg), source: "link:image_src" };

    const imgTag = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
    if (imgTag) return { title, imageUrl: toAbs(imgTag), source: "html:img" };

    return { title };
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
    if ((meta as any).imageUrl || (meta as any).title) {
      const m = meta as OgPick & { imageUrl?: string; title?: string; source?: BritpartBasic["imageSource"] };
      return {
        sku,
        title: m.title ?? sku,
        imageUrl: m.imageUrl,
        url: u,
        imageSource: m.imageUrl ? (m.source ?? "og:image") : "none",
      };
    }
  }
  return { sku, title: sku, imageSource: "none" };
}

/* --------------------------------------------------------------- */
/* Publik multi-funktion                                           */
/* --------------------------------------------------------------- */

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
        // Försök GetAll först, fallback om tomt
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

/* --------------------------------------------------------------- */
/* Bakåtkompatibelt hjälp-API                                      */
/* --------------------------------------------------------------- */

export type BritpartImportItem = {
  sku: string;
  name?: string;
  description?: string;
  priceGBP?: number;
  imageUrl?: string;
  categoryId?: number;
};

export async function britpartGetByCategories(
  categoryIds: number[]
): Promise<BritpartImportItem[]> {
  const codes = await britpartGetPartCodesForCategories(categoryIds);
  return codes.map((sku) => ({ sku }));
}
