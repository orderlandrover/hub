import { env } from "./env";

export async function wcFetch(path: string, init: RequestInit = {}) {
  const key = env("WC_KEY");
  const secret = env("WC_SECRET");
  const wpUrl = env("WP_URL");

  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  const url = `${wpUrl.replace(/\/$/, "")}/wp-json/wc/v3${path}`;

  return fetch(url, {
    ...init,
    headers: {
      "Authorization": `Basic ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
}