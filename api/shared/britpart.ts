import { env } from "./env";

// Expect BRITPART_BASE = "https://www.britpart.com" (NO trailing /api/v1 here)
const BASE = (env.BRITPART_BASE ?? "").replace(/\/+$/g, "");
const TOKEN = env.BRITPART_TOKEN ?? "";

if (!BASE || !TOKEN) {
  throw new Error("Missing env: BRITPART_BASE or BRITPART_TOKEN");
}

/** Build full Britpart API URL (adds /api/v1 and optional query). */
export function makeBritpartUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined>
): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${BASE}/api/v1${clean}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** Low-level fetch to Britpart with Token header + 60s timeout. */
export async function britpartFetch(
  pathOrUrl: string,
  init: RequestInit = {},
  query?: Record<string, string | number | boolean | undefined>
): Promise<Response> {
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(makeBritpartUrl(pathOrUrl, query));

  if (query && pathOrUrl.startsWith("http")) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (!headers.has("Token")) headers.set("Token", TOKEN);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "LD-Hub/1.0 (+functions)");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 60_000);

  try {
    return await fetch(url.toString(), { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Safe JSON helper – throws with a readable message if Britpart returns HTML/etc. */
export async function britpartJson<T = any>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const res = await britpartFetch(path, {}, query);
  const text = await res.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Britpart sometimes returns HTML error pages → surface a helpful error
    throw new Error(`Britpart ${path} ${res.status}: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    // If body is already JSON with error field, use that—otherwise include the snippet
    const msg = json?.error || `${res.status} ${res.statusText}`;
    throw new Error(`Britpart ${path}: ${msg}`);
  }
  return json as T;
}

/** 
 * Rekursiv funktion för att samla alla partCodes från en kategori och dess subkategorier.
 * Används när man väljer kategori i UI och vi måste hämta alla produkter i trädet.
 */
export function collectPartCodesFrom(cat: any): string[] {
  const collected: string[] = [];

  // Lägg till egna partCodes
  if (Array.isArray(cat?.partCodes)) {
    collected.push(...cat.partCodes.map((c: any) => String(c)));
  }

  // Rekursivt på subkategorier
  if (Array.isArray(cat?.subcategories)) {
    for (const sub of cat.subcategories) {
      collected.push(...collectPartCodesFrom(sub));
    }
  }

  return collected;
}