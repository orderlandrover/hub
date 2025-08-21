// Använder EXAKT samma app settings: BRITPART_BASE och BRITPART_TOKEN
type Params = Record<string, string | number | undefined>;

const BASE = (process.env.BRITPART_BASE || "").replace(/\/$/, "");
const TOKEN = process.env.BRITPART_TOKEN || "";

function requireEnv() {
  if (!BASE) throw new Error("Saknar App Setting: BRITPART_BASE");
  if (!TOKEN) throw new Error("Saknar App Setting: BRITPART_TOKEN");
}

function buildUrl(path: string, params: Params = {}) {
  requireEnv();

  // Om BASE redan pekar på en *full* endpoint (…/part/getcategories eller …/part/getall),
  // plocka ut prefixet fram till /part så att vi kan byta mellan getcategories/getall.
  const hasFull = /\/part\/(getall|getcategories)(?:$|\?)/i.test(BASE);
  const prefix = hasFull ? BASE.replace(/\/part\/(getall|getcategories).*$/i, "") : BASE;

  const rel = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${prefix}${rel}`);

  // token krävs alltid
  url.searchParams.set("token", TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export async function britpartGetCategories() {
  const url = buildUrl("/part/getcategories");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Britpart getcategories ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function britpartGetAll(subcategoryId: string, page = 1) {
  const url = buildUrl("/part/getall", { subcategoryId, page });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Britpart getall ${res.status}: ${await res.text()}`);
  return res.json();
}