import { env } from "./env";

/**
 * Bygger korrekt GET ALL-URL:
 *   {BASE}/api/v1/part/getall?token=...&subcategory=...&pagesize=...&page=...
 * Token skickas BÅDE som query och i headern “Token” (enligt Britparts svar).
 */
function buildGetAllUrl(params: { subcategory?: string; pagesize?: number; page?: number }) {
  const base = env.BRITPART_BASE.replace(/\/$/, "");
  const url = new URL(`${base}/api/v1/part/getall`);
  url.searchParams.set("token", env.BRITPART_TOKEN);
  if (params.subcategory) url.searchParams.set("subcategory", params.subcategory);
  if (params.pagesize) url.searchParams.set("pagesize", String(params.pagesize));
  if (params.page) url.searchParams.set("page", String(params.page));
  return url.toString();
}

/** Rått anrop till Britpart GetAll */
export async function britpartGetAll(params: { subcategory?: string; pagesize?: number; page?: number }) {
  const url = buildGetAllUrl(params);
  const res = await fetch(url, { headers: { Token: env.BRITPART_TOKEN } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}

/** Plocka ut artikelnummer från olika fältvarianter (“PartNo”, “Part No”, “partNumber”, …) */
export function readPartNumber(row: any): string {
  if (!row || typeof row !== "object") return "";
  const candidates = ["PartNo", "Part No", "PartNumber", "partnumber", "partNo", "part_no", "Code", "Part"];
  for (const k of Object.keys(row)) {
    if (candidates.some((c) => c.toLowerCase() === String(k).toLowerCase())) {
      const v = String(row[k] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

/** Plocka beskrivning */
export function readDescription(row: any): string {
  if (!row || typeof row !== "object") return "";
  const candidates = ["Description", "Desc", "LongDescription", "longDescription"];
  for (const k of Object.keys(row)) {
    if (candidates.some((c) => c.toLowerCase() === String(k).toLowerCase())) {
      const v = String(row[k] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}