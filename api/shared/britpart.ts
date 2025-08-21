import { env, assertEnv } from "./env";

/** Bygger alltid https://www.britpart.com/api/v1/{path}?token=...&... */
export function makeBritpartUrl(path: string, q: Record<string, any> = {}) {
  assertEnv("BRITPART_BASE", "BRITPART_TOKEN");
  const base = env.BRITPART_BASE.replace(/\/$/, "");   // EXAKT: "https://www.britpart.com"
  const url = new URL(base + "/api/v1" + (path.startsWith("/") ? path : `/${path}`));

  // query
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  // token om den inte redan finns i q
  if (!url.searchParams.get("token")) url.searchParams.set("token", env.BRITPART_TOKEN);

  return url.toString();
}

export async function britpartFetch(path: string, q: Record<string, any> = {}) {
  const url = makeBritpartUrl(path, q);
  return fetch(url, { method: "GET" });
}

// Hjälpare (frivilliga, för tydligare anrop)
export function britpartGetAllQuery(opts: { page?: number; code?: string; modifiedSince?: string } = {}) {
  const q: Record<string, any> = {};
  if (opts.page) q.page = opts.page;
  if (opts.code) q.code = opts.code;
  if (opts.modifiedSince) q.modifiedSince = opts.modifiedSince;
  return q;
}