// britpart.ts
import { env } from "./env";

export async function britpart(pathOrFull?: string, init: RequestInit = {}) {
  // Tillåter att BRITPART_API_BASE redan pekar på /part/getall
  const base = env.BRITPART_API_BASE.replace(/\/$/, "");
  const url = pathOrFull ? (pathOrFull.startsWith("http") ? pathOrFull : `${base}${pathOrFull}`) : base;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.BRITPART_API_KEY}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart ${res.status}: ${text}`);
  }
  return res;
}
