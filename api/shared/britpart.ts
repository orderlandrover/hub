import { env } from "./env";

function buildBritpartUrl(pathOrQuery: string) {
  const base = (env.BRITPART_API_BASE || "").replace(/\/$/, "");
  if (!pathOrQuery) return base;
  if (pathOrQuery.startsWith("?")) return base + pathOrQuery;
  if (pathOrQuery.startsWith("/")) return base + pathOrQuery;
  return `${base}/${pathOrQuery}`;
}

export async function britpart(pathOrQuery: string = "", init: RequestInit = {}) {
  const url = buildBritpartUrl(pathOrQuery);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(init.headers as any),
  };

  // Skicka nyckeln på två sätt för säkerhets skull
  if (env.BRITPART_API_KEY) {
    headers.Authorization = headers.Authorization || `Bearer ${env.BRITPART_API_KEY}`;
    headers["x-api-key"] = headers["x-api-key"] || env.BRITPART_API_KEY;
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}