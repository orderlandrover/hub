import { env } from "./env";

function base() {
  return env.BRITPART_BASE.replace(/\/$/, "");
}

async function fetchJson(u: URL) {
  const res = await fetch(u.toString(), { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Britpart ${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

export const britpart = fetchJson;  // Lägg till denna export för probe

export async function britpartGetCategories() {
  const u = new URL(`${base()}/part/getcategories`);
  u.searchParams.set("token", env.BRITPART_TOKEN);
  return fetchJson(u);
}

export async function britpartGetAll(opts: { page?: number; subcategoryId?: string }) {
  const u = new URL(`${base()}/part/getall`);
  u.searchParams.set("token", env.BRITPART_TOKEN);
  if (opts.subcategoryId) u.searchParams.set("subcategoryId", opts.subcategoryId);
  u.searchParams.set("page", String(opts.page ?? 1));
  return fetchJson(u);
}

export function readPartNumber(item: any): string | null {
  return item?.code || null;  // SKU från Britpart API (per GetAll-schema)
}

export function readDescription(item: any): string | null {
  return item?.title || item?.subText || null;  // Titel eller subText som beskrivning
}