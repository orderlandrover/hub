import { env as readEnv } from "./env";

/** Läser env och kastar tydligt fel om något saknas (om required=true) */
export function env(name: string, required: boolean = true): string {
  const v = readEnv(name, required);
  return v ?? "";
}

/**
 * Robust helper för Britpart API.
 * - Tillåter BRITPART_BASE med eller utan /api/v1
 * - Lägger token i både header och query (vissa installationer kräver query)
 * - Hanterar godtyckliga query-parametrar
 */
export async function britpartFetch(
  path: string,
  params: Record<string, any> = {},
  tokenOverride?: string
): Promise<Response> {
  const rawBase = env("BRITPART_BASE"); // ex: https://www.britpart.com eller https://www.britpart.com/api/v1
  const baseNoSlash = rawBase.replace(/\/+$/, "");
  const apiBase = /\/api\/v1$/.test(baseNoSlash) ? baseNoSlash : `${baseNoSlash}/api/v1`;

  const safePath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(apiBase + safePath);

  const token = tokenOverride || env("BRITPART_TOKEN", false) || "";
  if (token) url.searchParams.set("token", token);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers = new Headers({ Accept: "application/json" });
  if (token) headers.set("Token", token);

  return fetch(url.toString(), { method: "GET", headers });
}

/** Typer enligt Britparts dokumentation */
export type BritpartPart = {
  code: string;
  title?: string;
  content?: string;
  subText?: string;
  url?: string;
  imageUrls?: string[];
  datePublished?: string;
  similarParts?: string[];
  categoryIds?: number[];
  filterCategories?: any[];
};

export type BritpartGetAllResponse = {
  total: number;
  totalPages: number;
  page: number;
  parts: BritpartPart[];
};

/** Parametrar vi accepterar från äldre kod – extra nycklar ignoreras mot API:t */
export type GetAllParams = {
  page?: number;
  code?: string;
  modifiedSince?: string;
  // vissa äldre funktioner skickar subcategoryId – det stöds inte av getall, ignoreras
  subcategoryId?: number | string;
};

/**
 * Wrapper för /part/getall som alltid returnerar ett enhetligt svar.
 * - Ignorerar okända fält (t.ex. subcategoryId)
 * - Kastar tydligt feltext med HTTP-status + snippet om API svarar med HTML
 */
export async function britpartGetAll(
  params: GetAllParams = {},
  tokenOverride?: string
): Promise<BritpartGetAllResponse> {
  const q: Record<string, any> = {};
  if (params.page) q.page = params.page;
  if (params.code) q.code = params.code;
  if (params.modifiedSince) q.modifiedSince = params.modifiedSince;

  const res = await britpartFetch("/part/getall", q, tokenOverride);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Britpart getall ${res.status}: ${text.slice(0, 200)}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from Britpart getall. First bytes: ${text.slice(0, 80)}`);
  }

  return {
    total: Number(data?.total ?? (Array.isArray(data?.parts) ? data.parts.length : 0)),
    totalPages: Number(data?.totalPages ?? 1),
    page: Number(data?.page ?? params.page ?? 1),
    parts: Array.isArray(data?.parts) ? (data.parts as BritpartPart[]) : [],
  };
}

/**
 * Wrapper för /part/getcategories
 */
export async function britpartGetCategories(
  categoryId: number = 3,
  tokenOverride?: string
): Promise<any> {
  const res = await britpartFetch("/part/getcategories", { categoryId }, tokenOverride);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Britpart getcategories ${res.status}: ${text.slice(0, 200)}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from Britpart getcategories. First bytes: ${text.slice(0, 80)}`);
  }
  return data;
}

/** Små hjälpare som äldre kod kan använda */
export function readPartNumber(src: any): string {
  return String(src?.code ?? src?.sku ?? src?.["Part No"] ?? "").trim();
}
export function readDescription(src: any): string {
  return String(src?.title ?? src?.name ?? src?.Description ?? "").trim();
}