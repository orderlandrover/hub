// api/shared/wc.ts
import { env } from "./env";

const WP_URL = env.WP_URL.replace(/\/$/, "");
const WC_KEY = env.WC_KEY;
const WC_SECRET = env.WC_SECRET;

function authHeader(): string {
  const token = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

export async function wcFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${WP_URL}/wp-json/wc/v3${path}`;
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(url, { ...init, headers });
}

export async function wcFindProductBySku(sku: string): Promise<any | null> {
  const res = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
  if (!res.ok) return null;
  const arr = await res.json();
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

export async function wcCreateProduct(payload: any): Promise<Response> {
  return wcFetch(`/products`, { method: "POST", body: JSON.stringify(payload) });
}

export async function wcUpdateProduct(id: number, payload: any): Promise<Response> {
  return wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}