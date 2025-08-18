import { useEffect, useMemo, useState } from "react";

type WCProduct = {
  id: number;
  name: string;
  sku: string;
  status: "publish" | "draft" | "pending" | "private";
  regular_price?: string;
  stock_status?: string;
  stock_quantity?: number | null;
  images?: { src: string }[];
};

type ListResponse = {
  items: WCProduct[];
  total: number;
  pages: number;
  page: number;
};

export default function App() {
  const [status, setStatus] = useState<string>("any");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<ListResponse>({ items: [], total: 0, pages: 0, page: 1 });
  const [selected, setSelected] = useState<number[]>([]);

  const canPrev = page > 1;
  const canNext = page < (data.pages || 1);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const q = new URLSearchParams({ page: String(page), status, search });
      const res = await fetch(`/api/products-list?${q.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as ListResponse;
      setData(json);
    } catch (e: any) {
      setErr(e?.message || "Något gick fel");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  function toggle(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function toggleAll() {
    setSelected((s) => (s.length === data.items.length ? [] : data.items.map((p) => p.id)));
  }

  async function bulkUpdate(payload: Partial<{ status: WCProduct["status"]; price: string; stock_quantity: number }>) {
    if (selected.length === 0) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/products-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, ...payload }),
      });
      if (!res.ok) throw new Error(await res.text());
      await res.json();
      setSelected([]);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Kunde inte uppdatera");
    } finally {
      setLoading(false);
    }
  }

  const header = useMemo(() => (
    <div className="px-6 py-5 border-b bg-white sticky top-0 z-10">
      <div className="flex items-center gap-3 justify-between">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Britpart Integration Dashboard</h1>
        <a href="https://landroverdelar.se" className="text-sm opacity-70 hover:opacity-100" rel="noreferrer">Björklin Motor AB · landroverdelar.se</a>
      </div>
    </div>
  ), []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {header}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Sök</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Namn eller SKU" className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-xl border px-3 py-2">
                <option value="any">Alla</option>
                <option value="publish">Publicerad</option>
                <option value="draft">Utkast</option>
                <option value="pending">Pending</option>
                <option value="private">Privat</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setPage(1); load(); }} className="px-4 py-2 rounded-xl bg-black text-white">Hämta produkter</button>
              <button onClick={() => { setSearch(""); setStatus("any"); setPage(1); }} className="px-4 py-2 rounded-xl border">Rensa</button>
            </div>
          </div>
          {err && <p className="mt-2 text-red-600 text-sm">{err}</p>}
        </div>

        {/* Bulk actions */}
        <div className="bg-white rounded-2xl shadow-sm border p-4 mb-3 flex flex-wrap items-center gap-2">
          <button disabled={selected.length===0 || loading} onClick={() => bulkUpdate({ status: "publish" })} className="px-3 py-2 rounded-xl bg-emerald-600 disabled:opacity-50 text-white">Publicera</button>
          <button disabled={selected.length===0 || loading} onClick={() => bulkUpdate({ status: "draft" })} className="px-3 py-2 rounded-xl bg-amber-600 disabled:opacity-50 text-white">Avpublicera</button>
          <span className="text-sm opacity-70 ml-auto">Valda: {selected.length}</span>
        </div>

        {/* Table */}
        <div className="overflow-auto bg-white rounded-2xl shadow-sm border">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3 w-10"><input type="checkbox" onChange={toggleAll} checked={selected.length===data.items.length && data.items.length>0} /></th>
                <th className="p-3 text-left">Produkt</th>
                <th className="p-3 text-left">SKU</th>
                <th className="p-3 text-left">Pris</th>
                <th className="p-3 text-left">Lager</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">ID</th>
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
                <tr key={p.id} className="border-t">
                  <td className="p-3"><input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td className="p-3 flex items-center gap-3 min-w-[280px]">
                    {p.images?.[0]?.src && <img src={p.images[0].src} alt="" className="w-10 h-10 object-cover rounded-lg border" />}
                    <span className="font-medium leading-tight">{p.name || '(namnlös)'}</span>
                  </td>
                  <td className="p-3 font-mono">{p.sku || "—"}</td>
                  <td className="p-3">{p.regular_price || "—"}</td>
                  <td className="p-3">{p.stock_quantity ?? "—"} {p.stock_status && <span className="ml-1 opacity-60">({p.stock_status})</span>}</td>
                  <td className="p-3">{p.status}</td>
                  <td className="p-3">{p.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm opacity-70">Totalt: {data.total} · Sidor: {data.pages}</div>
          <div className="flex gap-2">
            <button disabled={!canPrev} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-2 rounded-xl border disabled:opacity-50">Föregående</button>
            <span className="px-2 py-2">{data.page}</span>
            <button disabled={!canNext} onClick={() => setPage((p) => p + 1)} className="px-3 py-2 rounded-xl border disabled:opacity-50">Nästa</button>
          </div>
        </div>

        <footer className="text-xs opacity-60 mt-10">© 2025 Björklin Motor AB · Prototype UI (SWA)</footer>
      </main>
    </div>
  );
}
