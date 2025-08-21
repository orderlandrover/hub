// src/lib/api.ts
const API_BASE = "/api";

type Query = Record<string, string | number | boolean | undefined>;

function qs(params: Query = {}) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined) return;
    u.set(k, String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : "";
}

// Normaliserar svar så UI alltid kan läsa .items, .total, .totalPages, .page
function normalizeList(data: any): { items: any[]; total: number; totalPages: number; page: number } {
  if (Array.isArray(data)) {
    return { items: data, total: data.length, totalPages: 1, page: 1 };
  }
  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.parts) ? data.parts : []);
  const total = Number(data?.total ?? items.length ?? 0);
  const totalPages = Number(data?.totalPages ?? data?.pages ?? 1);
  const page = Number(data?.page ?? 1);
  return { items, total, totalPages, page };
}

async function getJson<T = any>(path: string, params?: Query): Promise<T> {
  const res = await fetch(`${API_BASE}${path}${qs(params)}`);
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  wc: {
    categories: async (params?: Query) => {
      const raw = await getJson<any>("/wc-categories", params);
      return normalizeList(raw);
    },
    products: async (params?: Query) => {
      const raw = await getJson<any>("/products-list", params);
      return normalizeList(raw);
    },
  },
  britpart: {
    products: async (params?: Query) => {
      const raw = await getJson<any>("/britpart-products", params);
      return normalizeList(raw);
    },
    categories: async (params?: Query) => {
      // britpart-categories returnerar ett objekt; mappa subcategories/partCodes om du listar
      const raw = await getJson<any>("/britpart-categories", params);
      return raw;
    },
  },
};