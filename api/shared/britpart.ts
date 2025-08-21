import { env } from "./env";

export async function britpartFetch(
  path: string,
  params: Record<string, any> = {},
  tokenOverride?: string
) {
  const base = env("BRITPART_BASE");
  const token = tokenOverride || env("BRITPART_TOKEN");

  const url = new URL(base.replace(/\/$/, "") + "/api/v1" + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  if (token) url.searchParams.set("token", token);

  return fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });
}

export async function britpartGetAll(params: {
  page?: number;
  code?: string;
  modifiedSince?: string;
  subcategoryId?: number;   // 👈 nu stöds subcategoryId
}, tokenOverride?: string) {
  return britpartFetch("/part/getall", params, tokenOverride);
}

export async function britpartGetCategories(
  categoryId?: number,
  tokenOverride?: string
) {
  return britpartFetch(
    "/part/getcategories",
    { categoryId },
    tokenOverride
  );
}