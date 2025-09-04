import React, { useEffect, useRef, useState } from "react";

type WCProduct = {
  id: number;
  name: string;
  sku: string;
  status: "publish" | "draft" | "pending" | "private";
  regular_price?: string;
  stock_status?: string;
  stock_quantity?: number | null;
  categories?: { id: number; name?: string }[];
  images?: { src: string }[];
};
type ListResponse = { items: WCProduct[]; total: number; pages: number; page: number };

export default function ProductsTab() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<ListResponse>({ items: [], total: 0, pages: 0, page: 1 });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const ctrlRef = useRef<AbortController | null>(null);

  async function load() {
    try {
      setLoading(true);
      setErr("");
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;

      const q = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      const res = await fetch(`/api/products-list?${q.toString()}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      const items: WCProduct[] = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
      const total = Number(j?.total ?? items.length ?? 0);
      const pages = Number(j?.pages ?? 1);
      const p = Number(j?.page ?? page);
      setData({ items, total, pages, page: p });
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(e?.message || "Något gick fel");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, perPage]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm">Per sida</label>
        <select
          className="rounded-lg border px-2 py-1"
          value={perPage}
          onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
        >
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {err && <span className="text-red-600 text-sm">{err}</span>}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr className="[&>th]:p-3 [&>th]:text-left">
              <th>Produkt</th>
              <th>SKU</th>
              <th>Pris</th>
              <th>Lager</th>
              <th>Status</th>
              <th>Kategori</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-6 text-center">Laddar…</td></tr>
            )}
            {!loading && data.items.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center">Inga produkter</td></tr>
            )}
            {!loading && data.items.map((p) => (
              <tr key={p.id} className="border-t align-middle">
                <td className="p-3 min-w-[320px]">
                  <div className="flex items-center gap-3">
                    {p.images?.[0]?.src && (
                      <img src={p.images[0].src} alt="" className="w-10 h-10 object-cover rounded-lg border" />
                    )}
                    <span className="font-medium leading-tight">{p.name || "(namnlös)"}</span>
                  </div>
                </td>
                <td className="p-3 font-mono">{p.sku || "—"}</td>
                <td className="p-3">{p.regular_price ?? "—"}</td>
                <td className="p-3">
                  {p.stock_quantity ?? "—"} {p.stock_status && (<span className="ml-1 opacity-60">({p.stock_status})</span>)}
                </td>
                <td className="p-3">{p.status}</td>
                <td className="p-3">{p.categories?.[0]?.id ? `#${p.categories[0].id}` : "—"}</td>
                <td className="p-3">{p.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="text-sm opacity-70">Totalt: {data.total} · Sidor: {data.pages}</div>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            Föregående
          </button>
          <span className="px-2 py-2">{data.page}</span>
          <button
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= (data.pages || 1) || loading}
          >
            Nästa
          </button>
        </div>
      </div>
    </div>
  );
}
