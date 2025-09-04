// api/shared/britpart.ts
import { env } from "./env";

/* ------------------------------------------------------------------ */
/* SÄKER ENV-LÄSNING (ingen krasch på top-level)                      */
/* ------------------------------------------------------------------ */
function getBritpartConfig() {
  const baseRaw =
    (env as any)?.BRITPART_BASE ??
    process.env.BRITPART_BASE ??
    "https://www.britpart.com";
  const base = String(baseRaw).replace(/\/$/, "");
  const token =
    (env as any)?.BRITPART_TOKEN ??
    process.env.BRITPART_TOKEN;
  if (!token) {
    // Kastas inne i anrop → fångas av import-run och returneras som JSON-fel
    throw new Error("Missing BRITPART_TOKEN in environment");
  }
  return { base, token };
}

/* ------------------------------------------------------------------ */
/* Typer                                                              */
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

/** Minimal importstruktur (utökad) */
export type BritpartImportItem = {
  sku: string;               // Britpart partCode
  name?: string;
  description?: string;      // HTML ok
  price?: number | string;
  priceSEK?: number | string;
  unitPrice?: number | string;
  imageUrl?: string | string[];
  images?: Array<{ url?: string; src?: string; href?: string }>;
  categoryId?: number;
  currency?: string;
  extra?: any;
};

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
/* Resilient fetch mot Britpart                                       */
/* ------------------------------------------------------------------ */

export async function britpartFetchRaw(
  path: string,
  init?: RequestInit | Record<string, any>
) {
  const { base, token } = getBritpartConfig();

  const knownInit: RequestInit = {};
  const maybeParams: Record<string, any> = {};

  if (init && typeof init === "object") {
    const knownKeys: (keyof RequestInit)[] = [
      "method","headers","body","mode","credentials","cache","redirect",
      "referrer","referrerPolicy","integrity","keepalive","signal","window"
    ];
    for (const [k, v] of Object.entries(init)) {
      if ((knownKeys as string[]).includes(k)) {
        // @ts-expect-error
        knownInit[k] = v as any;
      } else {
        maybeParams[k] = v;
      }
    }
  }

  let url = path.startsWith("http")
    ? path
    : `${base}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

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
    Token: String(token),
  };

  let lastErr: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { ...knownInit, headers });
      if (res.ok) return res;

      if (res.status >= 500 || res.status === 429) {
        await sleep(400 + attempt * 300);
        continue;
      }
      const body = await res.text();
      throw new Error(`Britpart ${res.status}: ${body}`);
    } catch (e: any) {
      lastErr = e;
      await sleep(400 + attempt * 300);
    }
  }
  throw lastErr ?? new Error("Britpart call failed");
}

/* ------------------------------------------------------------------ */
/* Publika kategori-anrop                                             */
/* ------------------------------------------------------------------ */

export async function getCategory(id: number): Promise<BritpartCategoryResponse> {
  const res = await britpartFetchRaw(`/part/getcategories?id=${id}`);
  const json = await safeJson(res);
  return normalizeCategory(json);
}

export async function getRootCategories(): Promise<BritpartCategoryResponse> {
  const res = await britpartFetchRaw(`/part/getcategories?id=3`);
  const json = await safeJson(res);
  return normalizeCategory(json);
}

export async function getDirectSubcategories(
  parentId: number
): Promise<BritpartCategoryResponse["subcategories"]> {
  const parent = await getCategory(parentId);
  return parent.subcategories ?? [];
}

/* ------------------------------------------------------------------ */
/* Rekursiv insamling av partCodes (behålls)                          */
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

export async function britpartGetPartCodesForCategories(
  categoryIds: number[]
): Promise<string[]> {
  const seen = new Set<number>();
  const all: string[] = [];
  for (const id of categoryIds) {
    const codes = await collectPartCodesFrom(Number(id), seen, 0);
    all.push(...codes);
  }
  return Array.from(new Set(all.filter((s) => typeof s === "string" && s.trim().length > 0)));
}

/* ------------------------------------------------------------------ */
/* Produktdetaljer via “getpart/getparts/search” (behålls)            */
/* ------------------------------------------------------------------ */

function normalizePart(raw: any): BritpartImportItem | undefined {
  if (!raw) return undefined;

  const sku =
    raw?.sku ?? raw?.SKU ?? raw?.partCode ?? raw?.part_code ?? raw?.code ?? raw?.partNumber ?? raw?.part_number;
  if (!sku || (typeof sku === "string" && !sku.trim())) return undefined;

  const name = raw?.name ?? raw?.title ?? raw?.productName ?? raw?.product_name ?? undefined;
  const description =
    raw?.descriptionHtml ?? raw?.longDescription ?? raw?.long_description ??
    raw?.description ?? raw?.desc ?? raw?.shortDescription ?? raw?.short_description ?? undefined;

  const currency = raw?.currency ?? raw?.Currency ?? raw?.priceCurrency ?? undefined;
  const priceSEK = raw?.priceSEK ?? raw?.priceSek ?? raw?.price_sek ?? undefined;
  const unitPrice = raw?.unitPrice ?? raw?.unit_price ?? raw?.price ?? undefined;

  const images = raw?.images ?? raw?.gallery ?? raw?.assets ?? undefined;
  const imageUrl = raw?.imageUrl ?? raw?.image_url ?? raw?.image ?? raw?.img ?? raw?.thumbnail ?? undefined;

  return {
    sku: String(sku).trim(),
    name,
    description,
    price: unitPrice,
    priceSEK,
    unitPrice,
    currency,
    images,
    imageUrl,
    extra: raw,
  };
}

async function probePartDetails(partCode: string): Promise<any | undefined> {
  const candidates: Array<{ path: string; params: Record<string, any> }> = [
    { path: "/part/getpart",  params: { code: partCode } },
    { path: "/part/getpart",  params: { partCode: partCode } },
    { path: "/part/getparts", params: { codes: partCode } },
    { path: "/part/getparts", params: { partCodes: partCode } },
    { path: "/part/get",      params: { code: partCode } },
    { path: "/part/search",   params: { query: partCode } },
  ];

  for (const c of candidates) {
    try {
      const res = await britpartFetchRaw(c.path, c.params);
      const json = await safeJson<any>(res);
      const payload = json?.items ?? json;
      if (!payload) continue;

      if (Array.isArray(payload)) {
        const exact =
          payload.find((p: any) =>
            [p?.sku, p?.SKU, p?.partCode, p?.part_code, p?.code, p?.partNumber, p?.part_number]
              .map((v) => String(v ?? "").trim())
              .includes(String(partCode).trim())
          ) ?? payload[0];
        if (exact) return exact;
      } else {
        return payload;
      }
    } catch {
      await sleep(120);
    }
  }
  return undefined;
}

export async function britpartGetProductsByCodes(
  codes: string[],
  concurrency = 3
): Promise<BritpartImportItem[]> {
  const out: BritpartImportItem[] = [];
  const q = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];

  let i = 0;
  async function worker() {
    while (i < q.length) {
      const idx = i++;
      const code = q[idx];
      const raw = await probePartDetails(code);
      const norm = normalizePart(raw ?? { code });
      if (norm) out.push(norm);
      await sleep(60);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, q.length) }, worker));
  return out;
}

export async function britpartGetItemsForCategories(categoryIds: number[]): Promise<BritpartImportItem[]> {
  const codes = await britpartGetPartCodesForCategories(categoryIds);
  if (!codes.length) return [];
  return britpartGetProductsByCodes(codes);
}

/* Bakåtkompatibel export */
export { britpartFetchRaw as britpartFetch };

export async function britpartGetByCategories(categoryIds: number[]): Promise<BritpartImportItem[]> {
  return britpartGetItemsForCategories(categoryIds);
}

/* ------------------------------------------------------------------ */
/* NYTT: /part/getall – exakt som PHP-pluggen                         */
/* ------------------------------------------------------------------ */

function normalizeGetAllItem(it: any, subcategoryId?: number): BritpartImportItem | undefined {
  const sku = String(it?.code ?? "").trim();
  if (!sku) return undefined;
  const imageUrls: string[] = Array.isArray(it?.imageUrls)
    ? it.imageUrls.filter((u: any) => typeof u === "string" && /^https?:\/\//i.test(u))
    : [];
  return {
    sku,
    name: it?.title ?? undefined,
    description: it?.subText ?? "",
    imageUrl: imageUrls[0],
    images: imageUrls.map((url: string) => ({ url })),
    categoryId: subcategoryId,
  };
}

/** Hämta alla produkter för en subkategori via /part/getall med paginering */
export async function britpartGetAllBySubcategory(
  subcategoryId: number,
  pageSize = 200
): Promise<BritpartImportItem[]> {
  const out: BritpartImportItem[] = [];
  let page = 1;
  for (;;) {
    // Token i header sätts av britpartFetchRaw; här lämnar vi även subcategoryId/page
    const res = await britpartFetchRaw("/part/getall", { subcategoryId, page, pageSize });
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

/** Hämta produkter för flera subkategorier och deduplicera på SKU */
export async function britpartGetAllBySubcategories(
  categoryIds: number[],
  pageSize = 200
): Promise<BritpartImportItem[]> {
  const all: BritpartImportItem[] = [];
  for (const id of categoryIds) {
    const chunk = await britpartGetAllBySubcategory(Number(id), pageSize);
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
