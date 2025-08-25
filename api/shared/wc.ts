// api/shared/wc.ts
import { env } from "./env";

const WP_URL = env.WP_URL.replace(/\/$/, "");
const WC_KEY = env.WC_KEY;
const WC_SECRET = env.WC_SECRET;

function authHeader() {
  const token = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

export async function wcFetch(path: string, init?: RequestInit) {
  const url = `${WP_URL}/wp-json/wc/v3${path}`;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    Authorization: authHeader(),
    "Content-Type": "application/json",
  };
  return fetch(url, { ...init, headers });
}

/** Hitta Woo‑produkt via SKU, returnerar första träffen eller null */
export async function wcFindProductBySku(sku: string): Promise<any | null> {
  const res = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) && data[0] ? data[0] : null;
}