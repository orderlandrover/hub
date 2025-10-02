// api/_woo.ts
import fetch from "node-fetch";

const base = process.env.WOO_BASE_URL!;
const ck = process.env.WOO_CK!;
const cs = process.env.WOO_CS!;

if (!base || !ck || !cs) {
  console.warn("⚠️ WOO_BASE_URL / WOO_CK / WOO_CS saknas i env");
}

const auth = `consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`;

export type WooProduct = {
  id: number;
  categories: { id: number; name?: string }[];
  date_modified_gmt?: string;
};

export async function wooGetProduct(id: number): Promise<WooProduct> {
  const url = `${base}/wp-json/wc/v3/products/${id}?_fields=id,categories,date_modified_gmt&${auth}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Woo GET ${id} ${r.status}: ${await r.text()}`);
  return (await r.json()) as WooProduct;
}

export async function wooPutProductCategories(id: number, catIds: number[]): Promise<WooProduct> {
  const url = `${base}/wp-json/wc/v3/products/${id}?${auth}`;
  const body = JSON.stringify({ categories: catIds.map((x) => ({ id: x })) });
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
  if (!r.ok) throw new Error(`Woo PUT ${id} ${r.status}: ${await r.text()}`);
  return (await r.json()) as WooProduct;
}
