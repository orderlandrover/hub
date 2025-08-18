import { useEffect, useMemo, useRef, useState } from "react";

type WCProduct = {
  id: number;
  name: string;
  sku: string;
  status: "publish" | "draft" | "pending" | "private";
  regular_price?: string;
  stock_status?: string;
  stock_quantity?: number | null;
  images?: { src: string }[];
  categories?: { id: number; name: string }[];
};

type ListResponse = {
  items: WCProduct[];
  total: number;
  pages: number;
  page: number;
};

type WCCategory = { id: number; name: string; parent: number };

const UI = {
  btnPrimary:
    "inline-flex items-center justify-center gap-2 rounded-full bg-[#F6C343] px-5 py-2.5 font-semibold text-black shadow-sm ring-1 ring-black/5 hover:brightness-95 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F6C343]/60",
  btnSecondary:
    "inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-slate-900 shadow-sm hover:bg-slate-50 active:translate-y-px",
  btnDark:
    "inline-flex items-center justify-center gap-2 rounded-full bg-[#1F2937] px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-black active:translate-y-px",
  btnDanger:
    "inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-red-700 active:translate-y-px",
  badge:
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700",
};

export default function App() {
  const [status, setStatus] = useState<string>("any");
  const [search, setSearch] = useState<string>("");
  const [category, setCategory] = useState<number | "">("");
  const [page, setPage] = useState<number>(1);
  const [orderby, setOrderby] = useState<"title" | "date" | "id" | "sku" | "price">("title");
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");

  const [data, setData] = useState<ListResponse>({ items: [], total: 0, pages: 0, page: 1 });
  const [selected, setSelected] = useState<number[]>([]);
  const [categories, setCategories] = useState<WCCategory[]>([]);
  const [bulkPrice, setBulkPrice] = useState<string>("");
  const [bulkCategory, setBulkCategory] = useState<number | "">("");

  const ctrlRef = useRef<AbortController | null>(null);

  const canPrev = page > 1;
  const canNext = page < (data.pages || 1);

  async function load(over?: Partial<{ page: number; status: string; search: string; category: number | ""; orderby: string; order: string }>) {
    const p = over?.page ?? page;
    const st = over?.status ?? status;
    const se = (over?.search ?? search).trim();
    const cat = over?.category ?? category;
    const ob = (over?.orderby ?? orderby) as string;
    const od = (over?.order ?? order) as string;

    setLoading(true);
    setErr("");
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    try {
      const q = new URLSearchParams({
        page: String(p),
        status: st,
        search: se,
        orderby: ob,
        order: od,
      });
      if (cat) q.set("category", String(cat));

      const res = await fetch(`/api/products-list?${q.toString()}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as ListResponse;
      setData(json);
      setSelected([]);
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(e?.message || "Något gick fel");
    } finally {
      setLoading(false);
    }
  }

  // init: hämta kategorier
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/products-categories");
        if (r.ok) {
          const j = await r.json();
          setCategories(j.items || []);
        }
      } catch {}
    })();
  }, []);

  // auto-load när sida/status/category/sort ändras
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, category, orderby, order]);

  function toggle(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function toggleAll() {
    setSelected((s) => (s.length === data.items.length && data.items.length > 0 ? [] : data.items.map((p) => p.id)));
  }

  async function bulkUpdate(payload: Partial<{ status: WCProduct["status"]; price: string; category_id: number; category_ids: number[] }>) {
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

  async function bulkDelete() {
    if (selected.length === 0) return;
    if (!confirm(`Radera ${selected.length} produkt(er) från WooCommerce?`)) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/products-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected }),
      });
      if (!res.ok) throw new Error(await res.text());
      await res.json();
      setSelected([]);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Kunde inte radera");
    } finally {
      setLoading(false);
    }
  }

  const header = useMemo(
    () => (
      <div className="px-6 py-5 border-b bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3 justify-between">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Britpart Integration Dashboard</h1>
          <a href="https://landroverdelar.se" className="text-sm opacity-70 hover:opacity-100" rel="noreferrer">
            Björklin Motor AB · landroverdelar.se
          </a>
        </div>
      </div>
    ),
    []
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {header}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Sök</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Namn eller SKU"
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="rounded-xl border px-3 py-2 w-full"
              >
                <option value="any">Alla</option>
                <option value="publish">Publicerad</option>
                <option value="draft">Utkast</option>
                <option value="pending">Pending</option>
                <option value="private">Privat</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Kategori</label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value ? Number(e.target.value) : "");
                  setPage(1);
                }}
                className="rounded-xl border px-3 py-2 w-full"
              >
                <option value="">Alla</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent ? "— " : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={() => {
                  setPage(1);
                  load({ page: 1, search });
                }}
                className={UI.btnPrimary}
                disabled={loading}
              >
                {loading ? "Hämtar…" : "Hämta produkter"}
              </button>
              <button
                onClick={() => {
                  setSearch("");
                  setStatus("any");
                  setCategory("");
                  setOrderby("title");
                  setOrder("asc");
                  setPage(1);
                  load({ page: 1, status: "any", search: "", category: "", orderby: "title", order: "asc" });
                }}
                className={UI.btnSecondary}
                disabled={loading}
              >
                Rensa
              </button>
            </div>
          </div>

          {/* sort */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">Sortera:</span>
              <select value={orderby} onChange={(e) => setOrderby(e.target.value as any)} className="rounded-xl border px-2 py-1">
                <option value="title">Titel</option>
                <option value="sku">SKU</option>
                <option value="price">Pris</option>
                <option value="date">Datum</option>
                <option value="id">ID</option>
              </select>
              <select value={order} onChange={(e) => setOrder(e.target.value as any)} className="rounded-xl border px-2 py-1">
                <option value="asc">Stigande</option>
                <option value="desc">Fallande</option>
              </select>
            </div>
          </div>

          {err && <p className="mt-2 text-red-600 text-sm break-all">{err}</p>}
        </div>

        {/* Bulk actions */}
        <div className="bg-white rounded-2xl shadow-sm border p-4 flex flex-wrap items-center gap-2">
          <button disabled={selected.length === 0 || loading} onClick={() => bulkUpdate({ status: "publish" })} className={`${UI.btnPrimary} disabled:opacity-50`}>
            Publicera
          </button>
          <button disabled={selected.length === 0 || loading} onClick={() => bulkUpdate({ status: "draft" })} className={`${UI.btnDark} disabled:opacity-50`}>
            Avpublicera
          </button>

          {/* sätt pris */}
          <div className="flex items-center gap-2 ml-2">
            <input
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
              placeholder="Nytt pris (SEK)"
              className="w-36 rounded-xl border px-3 py-2"
            />
            <button
              disabled={selected.length === 0 || !bulkPrice || loading}
              onClick={() => bulkUpdate({ price: bulkPrice })}
              className={`${UI.btnSecondary} disabled:opacity-50`}
            >
              Sätt pris
            </button>
          </div>

          {/* sätt kategori */}
          <div className="flex items-center gap-2">
            <select
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value ? Number(e.target.value) : "")}
              className="rounded-xl border px-3 py-2"
            >
              <option value="">Välj kategori…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent ? "— " : ""}
                  {c.name}
                </option>
              ))}
            </select>
            <button
              disabled={selected.length === 0 || !bulkCategory || loading}
              onClick={() => bulkUpdate({ category_id: bulkCategory as number })}
              className={`${UI.btnSecondary} disabled:opacity-50`}
            >
              Sätt kategori
            </button>
          </div>

          <button disabled={selected.length === 0 || loading} onClick={bulkDelete} className={`${UI.btnDanger} disabled:opacity-50 ml-auto`}>
            Radera
          </button>

          <span className="text-sm opacity-70">Valda: {selected.length}</span>
        </div>

        {/* Table */}
        <div className="overflow-auto bg-white rounded-2xl shadow-sm border">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3 w-10">
                  <input type="checkbox" onChange={toggleAll} checked={data.items.length > 0 && selected.length === data.items.length} />
                </th>
                <th className="p-3 text-left">Produkt</th>
                <th className="p-3 text-left">SKU</th>
                <th className="p-3 text-left">Pris</th>
                <th className="p-3 text-left">Lager</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Kategori</th>
                <th className="p-3 text-left">ID</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="p-6 text-center">Laddar…</td></tr>}
              {!loading && data.items.length === 0 && <tr><td colSpan={8} className="p-6 text-center">Inga produkter</td></tr>}
              {!loading && data.items.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">
                    <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td className="p-3 flex items-center gap-3 min-w-[280px]">
                    {p.images?.[0]?.src && <img src={p.images[0].src} alt="" className="w-10 h-10 object-cover rounded-lg border" />}
                    <span className="font-medium leading-tight">{p.name || "(namnlös)"}</span>
                  </td>
                  <td className="p-3 font-mono">{p.sku || "—"}</td>
                  <td className="p-3">{p.regular_price || "—"}</td>
                  <td className="p-3">
                    {p.stock_quantity ?? "—"} {p.stock_status && <span className="ml-1 opacity-60">({p.stock_status})</span>}
                  </td>
                  <td className="p-3"><span className={UI.badge}>{p.status}</span></td>
                  <td className="p-3">{p.categories?.[0]?.name || "—"}</td>
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
            <button disabled={!canPrev || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} className={`${UI.btnSecondary} disabled:opacity-50`}>
              Föregående
            </button>
            <span className="px-2 py-2">{data.page}</span>
            <button disabled={!canNext || loading} onClick={() => setPage((p) => p + 1)} className={`${UI.btnSecondary} disabled:opacity-50`}>
              Nästa
            </button>
          </div>
        </div>

        <footer className="text-xs opacity-60 mt-10">© {new Date().getFullYear()} Björklin Motor AB · Prototype UI (SWA)</footer>
      </main>
    </div>
  );
}
