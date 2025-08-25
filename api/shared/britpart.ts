// api/shared/britpart.ts
import { env } from "./env";

/**
 * Bas-URL ska vara https://www.britpart.com (utan /api/v1)
 * Token ligger i BRITPART_TOKEN
 */
const BRITPART_BASE = env.BRITPART_BASE.replace(/\/$/, "");
const BRITPART_TOKEN = env.BRITPART_TOKEN;

function authHeaders(): Record<string, string> {
  return { Token: BRITPART_TOKEN };
}

/** Bygg en full Britpart-URL mot deras "api/v1" */
export function makeBritpartUrl(path: string): string {
  const p = path.replace(/^\/+/, "");
  return `${BRITPART_BASE}/api/v1/${p}`;
}

/** Litet fetch‑wrapper (utan JSON-hantering) */
export async function britpartFetch(path: string): Promise<Response> {
  const url = makeBritpartUrl(path);
  return fetch(url, { headers: authHeaders() });
}

/** Hämta JSON från Britpart API och returnera som objekt */
export async function britpartJson(path: string): Promise<any> {
  const res = await britpartFetch(path);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Britpart ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Britpart ${path} parse error: ${text.slice(0, 300)}`);
  }
}

/** Hämta en hel kategori‑nod (inkl. underkategorier + partCodes) */
export async function britpartGetCategoryNode(categoryId: number | string): Promise<any> {
  return britpartJson(`part/getcategories?categoryId=${encodeURIComponent(String(categoryId))}`);
}

/**
 * Samla partnummer (partCodes) rekursivt.
 * Alla fält är optional – vi skyddar oss mot undefined.
 */
export function collectPartCodesFrom(node: any, out: Set<string>): void {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const child of node) collectPartCodesFrom(child, out);
    return;
  }

  const list = Array.isArray(node.partCodes) ? (node.partCodes as string[]) : [];
  for (const code of list) {
    const sku = String(code || "").trim();
    if (sku) out.add(sku);
  }

  const subs = Array.isArray(node.subcategories) ? node.subcategories : [];
  for (const child of subs) collectPartCodesFrom(child, out);
}

/** Hämta alla partCodes för givna subcategoryIds */
export async function collectPartCodesForSubcategoryIds(ids: Array<number | string>): Promise<Set<string>> {
  const unique = new Set<string>();
  for (const id of ids) {
    try {
      const node = await britpartGetCategoryNode(id);
      collectPartCodesFrom(node, unique);
    } catch {
      // fortsätt nästa id
      continue;
    }
  }
  return unique;
}