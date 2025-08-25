// api/shared/britpart.ts
import { env } from "./env";

const BASE = env.BRITPART_BASE.replace(/\/$/, ""); // t.ex. https://www.britpart.com
const TOKEN = env.BRITPART_TOKEN;

export type BritpartCategory = {
  id: number;
  title: string;
  description?: string;
  url?: string;
  partCodes?: string[];
  subcategoryIds?: number[];
  subcategories?: BritpartCategory[];
};

function authHeaders(): Headers {
  const h = new Headers();
  h.set("Token", TOKEN);
  return h;
}

export async function britpartJson<T = unknown>(path: string): Promise<T> {
  const url = `${BASE}/api/v1/part/${path}`;
  const res = await fetch(url, { headers: authHeaders() });

  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : {}; } catch {
    throw new Error(`Britpart ${path} ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    throw new Error(`Britpart ${path} ${res.status}: ${text.slice(0, 400)}`);
  }
  return json as T;
}

// Hämtar en kategori-nod
export async function getCategory(categoryId: number): Promise<BritpartCategory> {
  return britpartJson<BritpartCategory>(`getcategories?categoryId=${categoryId}`);
}

/**
 * Samla SKU:er (partCodes) rekursivt från en eller flera startkategorier.
 * Tål att Britpart ibland skickar "subcategories" inbäddat och ibland bara "subcategoryIds".
 */
export async function collectPartCodesFromMany(
  categoryIds: number[],
  limit = 200_000
): Promise<string[]> {
  const out = new Set<string>();
  const stack: number[] = [...categoryIds];

  while (stack.length && out.size < limit) {
    const id = stack.pop()!;
    const node = await getCategory(id);

    if (Array.isArray(node.partCodes) && node.partCodes.length) {
      for (const code of node.partCodes) {
        if (out.size >= limit) break;
        out.add(String(code).trim());
      }
    }

    // Barn kan komma som subcategoryIds eller inbäddade subcategories
    const ids: number[] = [];
    if (Array.isArray(node.subcategoryIds)) {
      for (const cid of node.subcategoryIds) ids.push(Number(cid));
    }
    if (Array.isArray(node.subcategories)) {
      for (const c of node.subcategories) {
        if (typeof c?.id === "number") ids.push(c.id);
        if (Array.isArray(c?.partCodes)) {
          for (const code of c.partCodes) {
            if (out.size >= limit) break;
            out.add(String(code).trim());
          }
        }
        if (Array.isArray(c?.subcategoryIds)) {
          for (const cid of c.subcategoryIds) ids.push(Number(cid));
        }
      }
    }

    for (const cid of ids) stack.push(cid);
  }

  return Array.from(out);
}