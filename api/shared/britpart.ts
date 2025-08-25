// api/shared/britpart.ts
import { env } from "./env";

const BASE = env.BRITPART_BASE;         // t.ex. "https://www.britpart.com"
const TOKEN = env.BRITPART_TOKEN;

type CatNode = {
  id: number;
  title: string;
  partCodes?: string[];
  subcategoryIds?: number[];
};

type CatResponse = {
  id: number;
  title: string;
  partCodes: string[];
  subcategoryIds: number[];
  subcategories: CatNode[];
};

export async function bpFetch(path: string, init?: RequestInit) {
  const base = BASE.replace(/\/$/, "");
  const url = `${base}/api/v1${path}`;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    Token: TOKEN,
  };
  const res = await fetch(url, { ...init, headers });
  return res;
}

/** Hämta en nivå av kategori-trädet */
export async function getCategoryNode(categoryId: number): Promise<CatResponse> {
  const res = await bpFetch(`/part/getcategories?categoryId=${categoryId}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Britpart getcategories ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as CatResponse;
  } catch {
    throw new Error(`Britpart JSON parse fail (getcategories): ${text.slice(0, 200)}`);
  }
}

/** Rekursivt samla alla partCodes från en startkategori (inkl. blad som innehåller partCodes direkt) */
export async function collectPartCodesFrom(categoryId: number): Promise<{
  partCodes: Set<string>;
  visited: Set<number>;
}> {
  const partCodes = new Set<string>();
  const visited = new Set<number>();

  async function walk(id: number) {
    if (visited.has(id)) return;
    visited.add(id);

    const node = await getCategoryNode(id);

    (node.partCodes || []).forEach((c) => c && partCodes.add(c.trim()));

    // gå vidare ner om det finns barn
    const kids = node.subcategoryIds?.length
      ? node.subcategoryIds
      : (node.subcategories || []).map((s) => s.id);

    for (const kid of kids || []) {
      if (typeof kid === "number") await walk(kid);
    }
  }

  await walk(categoryId);
  return { partCodes, visited };
}