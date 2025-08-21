import { env } from "./env";

/** Bygger en URL mot GetAll/ GetCategories och lägger på token som query */
function withToken(u: URL) {
  if (env.BRITPART_TOKEN) u.searchParams.set("token", env.BRITPART_TOKEN);
  return u;
}

/** Anropar Britpart och sätter även "Token" header för säkerhets skull */
async function bfetch(input: string | URL, init: RequestInit = {}) {
  const url = typeof input === "string" ? new URL(input) : input;
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      ...(init.headers || {}),
      Token: env.BRITPART_TOKEN || "",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}

/** GetAll – produkter (stödjer subcategory + limit för test) */
export async function britpartGetAll(opts: { subcategory?: string; page?: number; pagesize?: number; q?: string }) {
  const base =
    env.BRITPART_GETALL_URL ||
    `${(env.BRITPART_API_BASE || "https://www.britpart.com/api/v1").replace(/\/$/, "")}/part/getall`;
  const u = withToken(new URL(base));
  if (opts.subcategory) u.searchParams.set("subcategory", opts.subcategory);
  if (opts.page) u.searchParams.set("page", String(opts.page));
  if (opts.pagesize) u.searchParams.set("pagesize", String(opts.pagesize));
  if (opts.q) u.searchParams.set("q", opts.q);
  return bfetch(u);
}

/** GetCategories – huvud/underkategorier */
export async function britpartGetCategories() {
  const base =
    env.BRITPART_GETCATEGORIES_URL ||
    `${(env.BRITPART_API_BASE || "https://www.britpart.com/api/v1").replace(/\/$/, "")}/part/getall/categories`;
  const u = withToken(new URL(base));
  return bfetch(u);
}

/** Hjälpare för olika fältnamn i svaret */
export function readPartNumber(row: any): string {
  return (
    row?.partNumber ||
    row?.part_no ||
    row?.partNo ||
    row?.PartNo ||
    row?.["Part No"] ||
    row?.["PartNo"] ||
    row?.code ||
    row?.sku ||
    ""
  ).toString().trim();
}
export function readDescription(row: any): string {
  return (row?.description || row?.Description || row?.name || "").toString();
}
export function readPriceGBP(row: any): number | undefined {
  const v = row?.price ?? row?.Price ?? row?.GBP ?? row?.gbp;
  if (v == null) return undefined;
  const n = Number(String(v).replace(",", ".").replace(/[^\d.-]/g, ""));
  return isFinite(n) ? n : undefined;
}