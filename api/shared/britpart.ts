import { env } from "./env";

/**
 * Kallar Britpart och lägger alltid till ?token=… som query.
 * Använd path som "/part/getall" och valfria extra query-parametrar via `query`.
 */
export async function britpart(
  path: string,
  init: RequestInit = {},
  query: Record<string, string | number | boolean> = {}
) {
  const base = env.BRITPART_API_BASE?.replace(/\/$/, "") || "";
  const url = new URL(base + path);

  // lägg på token + ev övriga query-parametrar
  url.searchParams.set("token", env.BRITPART_API_KEY || "");
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
      // OBS: ingen Authorization här – Britpart vill ha token i query eller "Token" header
    },
  });

  // Britpart kan returnera en HTML-sida vid fel (404/403). Gör felet läsbart.
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  // Låt anroparen parsa JSON själv (vissa endpoints kan svara med annat)
  return res;
}