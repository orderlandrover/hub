import { env } from "./env";

export async function britpart(path: string, init: RequestInit = {}) {
  const url = `${env.BRITPART_API_BASE.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.BRITPART_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}