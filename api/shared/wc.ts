import { env, assertEnv } from "./env";

export async function wcFetch(path: string, init: RequestInit = {}) {
  assertEnv("WP_URL", "WC_KEY", "WC_SECRET");
  const base = env.WP_URL.replace(/\/$/, "");
  const url = `${base}/wp-json/wc/v3${path.startsWith("/") ? path : `/${path}`}`;

  const auth = Buffer.from(`${env.WC_KEY}:${env.WC_SECRET}`).toString("base64");
  const headers = {
    "Authorization": `Basic ${auth}`,
    "Content-Type": "application/json",
    ...init.headers,
  };

  return fetch(url, { ...init, headers });
}

export async function readJsonSafe(res: Response): Promise<{ json: any; text: string }> {
  const text = await res.text();
  try { return { json: text ? JSON.parse(text) : null, text }; }
  catch { return { json: null, text }; }
}