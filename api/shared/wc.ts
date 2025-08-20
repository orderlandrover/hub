import { env } from "./env";

function basicAuth() {
  const token = Buffer.from(`${env.WC_KEY}:${env.WC_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

export async function wcRequest(path: string, init: RequestInit = {}) {
  const url = `${env.WP_URL.replace(/\/$/, "")}/wp-json/wc/v3${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WC ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}

export async function getProductBySku(sku: string) {
  const r = await wcRequest(`/products?sku=${encodeURIComponent(sku)}`);
  const arr = await r.json();
  return Array.isArray(arr) ? arr[0] || null : null;
}