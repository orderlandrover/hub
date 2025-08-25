// api/shared/britpart.ts
import { env } from "./env";

// ======== Typer ========
// Vad Britpart /part/getcategories returnerar (rooten har id=3 "All Parts")
export type BritpartCategory = {
  id: number;
  title: string;
  description?: string;
  url?: string;
  partCodes: string[];
  subcategoryIds: number[];
  subcategories?: BritpartCategory[];
};

// Platt produktpost efter att vi expanderat partCodes
export type BritpartImportItem = {
  sku: string;          // Britpart part code (tidigare "partNo")
  name: string;
  description?: string;
  image?: string;
  priceGBP?: number;    // ev. framtid
  categoryId: number;   // vilken subkategori som gav upphov
};

// ======== Hjälpare för requests ========
const BASE = env.BRITPART_BASE.replace(/\/$/, ""); // ex https://www.britpart.com
const TOKEN = env.BRITPART_TOKEN;

// GET mot Britpart API med Token header
async function britpartGet<T>(path: string): Promise<T> {
  const url = `${BASE}/api/v1${path}`;
  const res = await fetch(url, {
    headers: { Token: TOKEN }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Britpart ${path} ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

// ======== Publika API:n ========

// Hämta hela kategoriträdet (All Parts -> subcategories[])
export async function getRootCategories(): Promise<BritpartCategory> {
  // /part/getcategories?categoryId=3
  // 3 = "All Parts" och innehåller alla underkategorier
  const data = await britpartGet<BritpartCategory>(`/part/getcategories?categoryId=3`);
  return data;
}

// Flattar valda categoryIds (1..n nivåer) till en lista av BritpartImportItem.
// All logik för att läsa partCodes från nivåer och subnivåer ligger här.
export async function britpartGetByCategories(categoryIds: number[]): Promise<BritpartImportItem[]> {
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
    throw new Error("categoryIds required");
  }

  const root = await getRootCategories();

  // Samla alla kategorier som matchar ids (på valfri nivå)
  const bag: BritpartCategory[] = [];
  const wanted = new Set(categoryIds.map(Number));

  const walk = (node: BritpartCategory) => {
    if (wanted.has(node.id)) bag.push(node);
    node.subcategories?.forEach(walk);
  };
  walk(root);

  // Om man valde en kategori som saknar subcategories men har partCodes i djupare led
  // så behöver vi även hämta dess subkategorier och lägga till
  // (I praktiken räcker det att platta *alla* valda noder + deras subnoder)
  const allChosen: BritpartCategory[] = [];
  const addTree = (n: BritpartCategory) => {
    allChosen.push(n);
    n.subcategories?.forEach(addTree);
  };
  bag.forEach(addTree);

  // Bygg produkter
  const items: BritpartImportItem[] = [];
  for (const cat of allChosen) {
    // 1) direkta partCodes i cat
    for (const code of cat.partCodes || []) {
      items.push({
        sku: String(code).trim(),
        name: cat.title ?? "",
        description: cat.description ?? "",
        categoryId: cat.id,
      });
    }
    // 2) om cat saknar partCodes men har subcategoryIds utan att subcategories är med,
    // hämta dem med ett extra anrop (edge case – Britpart API kan ibland ge bara ids)
    if ((!cat.partCodes || cat.partCodes.length === 0) &&
        Array.isArray(cat.subcategoryIds) && cat.subcategoryIds.length > 0 &&
        (!cat.subcategories || cat.subcategories.length === 0)) {

      for (const subId of cat.subcategoryIds) {
        const sub = await britpartGet<BritpartCategory>(`/part/getcategories?categoryId=${subId}`);
        // Lägg in sub.partCodes
        for (const code of sub.partCodes || []) {
          items.push({
            sku: String(code).trim(),
            name: sub.title ?? "",
            description: sub.description ?? "",
            categoryId: sub.id,
          });
        }
        // Och eventuella sub-sub
        sub.subcategories?.forEach((s2) => {
          for (const code of s2.partCodes || []) {
            items.push({
              sku: String(code).trim(),
              name: s2.title ?? "",
              description: s2.description ?? "",
              categoryId: s2.id,
            });
          }
        });
      }
    }
  }

  // Rensa skräp och dubbletter
  const seen = new Set<string>();
  const dedup = items.filter((x) => {
    if (!x.sku) return false;
    if (seen.has(x.sku)) return false;
    seen.add(x.sku);
    return true;
  });

  return dedup;
}