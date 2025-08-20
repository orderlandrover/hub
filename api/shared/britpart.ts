import { env } from "./env";

function join(base: string, path: string) {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

export async function britpartJson(path: string, init: RequestInit = {}) {
  const url = join(env.BRITPART_API_BASE, path);
  const res = await fetch(url, {
    ...init,
    headers: {
      // Lägg till auth-header här om Britpart kräver nyckel/token
      "Accept": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    // Skicka upp till 300 tecken av svaret så ser vi direkt om det är HTML
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Britpart: svarade inte med JSON (började med: ${text.slice(0, 120)})`);
  }
}