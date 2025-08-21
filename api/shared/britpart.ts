import { env } from "./env";

/** Grund-URL, t.ex. https://www.britpart.com/api/v1/part/getall */
function base(): string {
  const b = (process.env.BRITPART_BASE || env.BRITPART_API_BASE || "").trim();
  if (!b) throw new Error("Missing App Setting: BRITPART_BASE");
  return b.replace(/\/$/, "");
}

/** GET /parts med Token-header + ?token=... (Britparts krav) */
export async function britpartGetAll(query: Record<string, any> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  if (process.env.BRITPART_TOKEN) qs.set("token", String(process.env.BRITPART_TOKEN));

  const url = `${base()}/parts?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      // Britpart accepterar även Token-headern:
      ...(process.env.BRITPART_TOKEN ? { Token: String(process.env.BRITPART_TOKEN) } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}