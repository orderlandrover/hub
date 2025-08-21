// api/shared/britpart.ts
import { env } from "./env";

/** Bygger URL utifrån BRITPART_BASE (som i Azure), utan att ändra namnet. */
function buildUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (env.BRITPART_BASE || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/** Liten klient som funkar oavsett om gateway vill ha Bearer eller x-api-key. */
export async function britpart(path: string, init: RequestInit = {}) {
  const url = buildUrl(path);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    // vanligast:
    Authorization: `Bearer ${env.BRITPART_TOKEN}`,
    // alternativ som vissa gateways kräver:
    "x-api-key": env.BRITPART_TOKEN,
    "X-API-KEY": env.BRITPART_TOKEN,
    ...(init.headers as any),
  };

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${text.slice(0, 1000)}`);
  }
  return res;
}

/* ------- Typer (tillräckligt breda för att undvika TS-fel) ------- */
export type BPCategory = {
  id?: string | number;
  code?: string;
  name?: string;
  description?: string;
  subcategories?: BPSubcat[];
};

export type BPSubcat = {
  id?: string | number;
  code?: string;
  name?: string;
  description?: string;
  /** vissa flöden vill lista partkoder under subkategori */
  partCodes?: string[];
};

/* ------- Högre nivå -------- */

/** Hämtar kategoriträdet (GetCategories) */
export async function britpartGetCategories() {
  const res = await britpart("/part/getcategories");
  return res.json(); // schema kommer från Britpart, vi skickar vidare rakt av
}

/** Hämtar en sida från GetAll. Querystring skickas vidare oförändrad. */
export async function britpartGetAll(search: string) {
  const path =
    "/part/getall" + (search ? (search.startsWith("?") ? search : `?${search}`) : "");
  const res = await britpart(path);
  return res.json();
}