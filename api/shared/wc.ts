// api/shared/wc.ts
import { env } from "./env";

// ---- Env & helpers ---------------------------------------------------------
const WP_URL = (env.WP_URL ?? "").replace(/\/+$/g, ""); // no trailing slash
const WC_KEY = env.WC_KEY ?? "";
const WC_SECRET = env.WC_SECRET ?? "";

if (!WP_URL || !WC_KEY || !WC_SECRET) {
  throw new Error("Missing env: WP_URL / WC_KEY / WC_SECRET");
}

function authHeader(): string {
  const token = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

// ---- Woo fetch --------------------------------------------------------------
export async function wcFetch(path: string, init: RequestInit = {}) {
  const url = path.startsWith("http")
    ? path
    : `${WP_URL}/wp-json/wc/v3${path.startsWith("/") ? path : `/${path}`}`;

  // Build headers safely (TS-friendly for Node 18 global fetch)
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (!headers.has("Authorization")) headers.set("Authorization", authHeader());
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("User-Agent", "LD-Hub/1.0 (+functions)");

  // 30s timeout to avoid hanging calls
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      ...(init as RequestInit),
      headers,
      signal: controller.signal,
    } as RequestInit);
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/** Hitta Woo‑produkt via SKU, returnerar första träffen eller null */
export async function wcFindProductBySku(sku: string): Promise<any | null> {
  const res = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
  if (!res.ok) return null;
  try {
    const data = await res.json();
    return Array.isArray(data) && data[0] ? data[0] : null;
  } catch {
    return null;
  }
}