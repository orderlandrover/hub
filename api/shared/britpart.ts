import { InvocationContext } from "@azure/functions";

// Base fetch-helper för Britpart API (använd HTTPS, lägg till token från env)
export async function britpart(path: string, params: Record<string, any> = {}, ctx?: InvocationContext) {
  const token = process.env.BRITPART_API_TOKEN;
  if (!token) {
    throw new Error("BRITPART_API_TOKEN missing in env");
  }
  const searchParams = new URLSearchParams({ token, ...params });
  const url = `https://www.britpart.com/api/v1${path}?${searchParams.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Britpart API error: ${res.status} - ${text}`);
  }
  return res;
}

// För GetAll (hämta produkter paginerat eller per code)
export async function britpartGetAll(params: { code?: string; page?: number; modifiedSince?: string } = {}, ctx?: InvocationContext) {
  return britpart('/part/getall', params, ctx);
}

// För GetCategories (hämta kategorier och sub med partCodes)
export async function britpartGetCategories(params: { categoryId?: string } = {}, ctx?: InvocationContext) {
  return britpart('/part/getcategories', params, ctx);
}