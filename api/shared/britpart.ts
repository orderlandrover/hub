import { env } from "./env";

function buildUrl(params: Record<string, any> = {}) {
  // env.BRITPART_API_BASE ska vara exakt .../api/v1/part/getall
  const base = env.BRITPART_API_BASE.replace(/\/$/, "");
  const url = new URL(base);

  const q = new URLSearchParams(url.search);
  if (env.BRITPART_API_KEY) q.set("token", env.BRITPART_API_KEY);

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  url.search = q.toString();
  return url.toString();
}

/** Rå-respons från Britpart getall */
export async function britpartGetAll(params: Record<string, any> = {}) {
  const url = buildUrl(params);
  const res = await fetch(url, {
    // vissa installationer accepterar även denna header:
    headers: { Token: env.BRITPART_API_KEY || "" },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${txt}`);
  }
  return res;
}

/** JSON-helper med tydligt fel om svaret inte är JSON */
export async function britpartGetAllJSON<T = any>(params: Record<string, any> = {}) {
  const res = await britpartGetAll(params);
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`Britpart-svaret var inte JSON: ${txt.slice(0, 400)}…`);
  }
}