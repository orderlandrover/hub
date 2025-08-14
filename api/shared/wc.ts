import { env } from "./env";

function authHeader() {
  const token = Buffer.from(`${env.WC_KEY}:${env.WC_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

export async function wcRequest(path: string, init: RequestInit = {}) {
  const url = `${env.WP_URL.replace(/\/$/, "")}/wp-json/wc/v3${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WC ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}