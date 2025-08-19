import { useEffect, useMemo, useRef, useState } from "react";
import "./brand.css";

/* ---------- Typer ---------- */
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
type WCCategory = { id: number; name: string; parent: number };

/* ---------- Tema ---------- */
const brand = {
  card: "bg-white rounded-2xl shadow-sm border",
  chip: "inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize",
  btn: {
    // enligt din spec: gul bakgrund, ljus text
    primary: "bg-[#d4af37] text-[#fffc] hover:brightness-95 focus:ring-2 focus:ring-white/20",
    secondary: "bg-[#d4af37] text-[#fffc] hover:brightness-95",
    accent: "bg-[#d4af37] text-[#fffc] hover:brightness-95",
    danger: "bg-[#d4af37] text-[#fffc] hover:brightness-95",
  },
};

/* ===================================================================== */
export default function App() {
  const [tab, setTab] = useState<"products" | "import">("products");

  const header = useMemo(
    () => (
      <header className="bm-header sticky top-0 z-20 shadow">
        <div className="w-full px-6 py-4 flex items-center justify-between">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Britpart Integration Dashboard</h1>
          <a href="https://landroverdelar.se" className="text-sm opacity-80 hover:opacity-100" rel="noreferrer">
            Björklin Motor AB · landroverdelar.se
          </a>
        </div>
      </header>
    ),
    []
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {header}

      <main className="w-full px-6 py-6">
        {/* Tabs */}
        <div className="mb-6 flex gap-2">
          <button
            className={`px-4 py-2 rounded-lg border font-semibold ${
              tab === "products" ? "bg-white shadow" : "bg-slate-100 hover:bg-white"
            }`}
            onClick={() => setTab("products")}
          >
            Produkter
          </button>
          <button
            className={`px-4 py-2 rounded-lg border font-semibold ${
              tab === "import" ? "bg-white shadow" : "bg-slate-100 hover:bg-white"
            }`}
            onClick={() => setTab("import")}
          >
            Import & synk
          </button>
        </div>

        {tab === "products" ? <ProductsTab /> : <ImportTab />}
      </main>
    </div>
  );
}

/* =====================================================================
   Flik 1 – Produkter
===================================================================== */
function ProductsTab() {
  // filters
  const [status, setStatus] = useState<string>("any");
  const [search, setSearch] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [orderby, setOrderby] = useState<"title" | "date" | "id" | "price">("title");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [perPage, setPerPage] = useState<number>(100);
  const [page, setPage] = useState<number>(1);

  // data
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<ListResponse>({ items: [], total: 0, pages: 0, page: 1 });
  const [selected, setSelected] = useState<number[]>([]);
  const [cats, setCats] = useState<WCCategory[]>([]);
  const ctrlRef = useRef<AbortController | null>(null);

  const canPrev = page > 1;
  const canNext = page < (data.pages || 1);

  async function load(
    over?: Partial<{
      page: number;
      status: string;
      search: string;
      category: string;
      orderby: string;
      order: string;
      per_page: number;
    }>
  ) {
    const p = over?.page ?? page;
    const st = over?.status ?? status;
    const se = (over?.search ?? search).trim();
    const cat = over?.category ?? category;
    const ob = (over?.orderby ?? orderby) as string;
    const od = (over?.order ?? order) as string;
    const pp = over?.per_page ?? perPage;

    setLoading(true);
    setErr("");
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    try {
      const q = new URLSearchParams({
        page: String(p),
        orderby: ob,
        order: od,
        per_page: String(pp),
      });
      if (st !== "any") q.set("status", st);
      if (se) q.set("search", se);
      if (cat) q.set("category", cat);

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

  async function loadCategories() {
    try {
      const res = await fetch("/api/wc-categories");
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { items: WCCategory[] };
      setCats(json.items || []);
    } catch (e: any) {
      console.error(e);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, orderby, order, perPage]);
  useEffect(() => {
    loadCategories();
  }, []);

  function toggle(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function toggleAllOnPage() {
    setSelected((s) => (s.length === data.items.length && data.items.length > 0 ? [] : data.items.map((p) => p.id)));
  }

  async function bulkUpdate(payload: Partial<{ status: WCProduct["status"]; price: string; stock_quantity: number; categoryId: number }>) {
    if (selected.length === 0 || loading) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/products-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, ...payload }),
      });
      const text = await res.text();
      const j = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(j?.error || text || "Kunde inte uppdatera");
      setSelected([]);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Kunde inte uppdatera");
    } finally {
      setLoading(false);
    }
  }

  // Robust radering + tydlig dialog
  async function bulkDelete() {
    if (selected.length === 0 || loading) return;
    if (!confirm(`Radera ${selected.length} produkt(er) permanent i WooCommerce?`)) return;

    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/products-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected }),
      });

      // Tillåt tom body (204) eller 200 med plain text/json
      const text = await res.text();
      let payload: any = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: text };
        }
      }

      if (!res.ok) {
        const msg = payload?.error || text || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      setSelected([]);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Kunde inte radera");
    } finally {
      setLoading(false);
    }
  }

  function askNewPrice() {
    if (selected.length === 0) return;
    const v = prompt("Nytt pris (SEK):", "");
    if (!v) return;
    const clean = v.replace(",", ".").trim();
    if (!/^\d+(\.\d+)?$/.test(clean)) {
      alert("Ogiltigt pris");
      return;
    }
    bulkUpdate({ price: clean });
  }

  function assignCategory() {
    if (selected.length === 0) return;
    const val = prompt("Sätt kategori-id (WooCommerce):", "");
    const id = val ? Number(val) : 0;
    if (!id) return;
    bulkUpdate({ categoryId: id });
  }

  return (
    <>
      {/* Filters */}
      <section className={`${brand.card} p-4 mb-6`}>
        <div className="grid xl:grid-cols-12 gap-3 items-end">
          <div className="xl:col-span-5">
            <label className="block text-sm font-medium mb-1">Sök</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Namn eller SKU"
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div className="xl:col-span-2">
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="any">Alla</option>
              <option value="publish">Publicerad</option>
              <option value="draft">Utkast</option>
              <option value="pending">Pending</option>
              <option value="private">Privat</option>
            </select>
          </div>
          <div className="xl:col-span-3">
            <label className="block text-sm font-medium mb-1">Kategori</label>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="">Alla</option>
              {cats.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name} · #{c.id}
                </option>
              ))}
            </select>
          </div>
          <div className="xl:col-span-2 flex gap-2">
            <button
              onClick={() => {
                setPage(1);
                load({ page: 1, search, category, orderby, order, per_page: perPage, status });
              }}
              className={`px-4 py-2 rounded-lg ${brand.btn.primary}`}
              disabled={loading}
            >
              {loading ? "Hämtar…" : "Hämta produkter"}
            </button>
            <button
              onClick={() => {
                setSearch("");
                setStatus("any");
                setCategory("");
                setPage(1);
                load({ page: 1, search: "", status: "any", category: "" });
              }}
              className={`px-4 py-2 rounded-lg ${brand.btn.secondary}`}
              disabled={loading}
            >
              Rensa
            </button>
          </div>

          <div className="xl:col-span-12 grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">Sortera:</span>
              <select value={orderby} onChange={(e) => setOrderby(e.target.value as any)} className="rounded-lg border px-2 py-1">
                <option value="title">Titel</option>
                <option value="price">Pris</option>
                <option value="date">Datum</option>
                <option value="id">ID</option>
              </select>
              <select value={order} onChange={(e) => setOrder(e.target.value as any)} className="rounded-lg border px-2 py-1">
                <option value="asc">Stigande</option>
                <option value="desc">Fallande</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">Per sida:</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-lg border px-2 py-1"
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            {err && <div className="col-span-full text-red-600 text-sm break-all">{err}</div>}
          </div>
        </div>
      </section>

      {/* Bulk actions */}
      <section className={`${brand.card} p-4 mb-4 flex flex-wrap items-center gap-3`}>
        <button
          disabled={selected.length === 0 || loading}
          onClick={() => bulkUpdate({ status: "publish" })}
          className={`px-4 py-2 rounded-lg ${brand.btn.accent} disabled:opacity-50`}
        >
          Publicera
        </button>
        <button
          disabled={selected.length === 0 || loading}
          onClick={() => bulkUpdate({ status: "draft" })}
          className={`px-4 py-2 rounded-lg ${brand.btn.secondary} disabled:opacity-50`}
        >
          Avpublicera
        </button>
        <button
          disabled={selected.length === 0 || loading}
          onClick={askNewPrice}
          className={`px-4 py-2 rounded-lg ${brand.btn.secondary} disabled:opacity-50`}
        >
          Nytt pris (SEK)
        </button>
        <button
          disabled={selected.length === 0 || loading}
          onClick={assignCategory}
          className={`px-4 py-2 rounded-lg ${brand.btn.secondary} disabled:opacity-50`}
        >
          Sätt kategori
        </button>
        <button
          disabled={selected.length === 0 || loading}
          onClick={bulkDelete}
          className={`ml-auto px-4 py-2 rounded-lg ${brand.btn.danger} disabled:opacity-50`}
        >
          Radera
        </button>
        <span className="text-sm opacity-70">Valda: {selected.length}</span>
      </section>

      {/* Table */}
      <section className={`${brand.card} overflow-auto`}>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr className="[&>th]:p-3 [&>th]:text-left">
              <th className="w-10">
                <input type="checkbox" onChange={toggleAllOnPage} checked={data.items.length > 0 && selected.length === data.items.length} />
              </th>
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
              <tr>
                <td colSpan={8} className="p-6 text-center">
                  Laddar…
                </td>
              </tr>
            )}
            {!loading && data.items.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center">
                  Inga produkter
                </td>
              </tr>
            )}
            {!loading &&
              data.items.map((p) => (
                <tr key={p.id} className="border-t align-middle">
                  <td className="p-3">
                    <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td className="p-3 min-w-[320px]">
                    <div className="flex items-center gap-3">
                      {p.images?.[0]?.src && <img src={p.images[0].src} alt="" className="w-10 h-10 object-cover rounded-lg border" />}
                      <span className="font-medium leading-tight">{p.name || "(namnlös)"}</span>
                    </div>
                  </td>
                  <td className="p-3 font-mono">{p.sku || "—"}</td>
                  <td className="p-3">{p.regular_price ?? "—"}</td>
                  <td className="p-3">
                    {p.stock_quantity ?? "—"} {p.stock_status && <span className="ml-1 opacity-60">({p.stock_status})</span>}
                  </td>
                  <td className="p-3">
                    <span className={brand.chip}>{p.status}</span>
                  </td>
                  <td className="p-3">{p.categories?.[0]?.id ? `#${p.categories[0].id}` : "—"}</td>
                  <td className="p-3">{p.id}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      {/* Pagination */}
      <section className="mt-4 flex items-center justify-between">
        <div className="text-sm opacity-70">
          Totalt: {data.total} · Sidor: {data.pages}
        </div>
        <div className="flex gap-2">
          <button
            disabled={!canPrev || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Föregående
          </button>
          <span className="px-2 py-2">{data.page}</span>
          <button
            disabled={!canNext || loading}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Nästa
          </button>
        </div>
      </section>
    </>
  );
}

/* =====================================================================
   Flik 2 – Import & synk
===================================================================== */
function ImportTab() {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [pub, setPub] = useState(true);
  const [bpSubs, setBpSubs] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/britpart-subcategories");
        const j = await res.json();
        setBpSubs(j.items || []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  function addLog(s: string) {
    const stamp = new Date().toLocaleString();
    setLog((prev) => [`[${stamp}] ${s}`, ...prev].slice(0, 400));
  }

  async function handlePriceUpload(file: File) {
    try {
      setBusy(true);
      addLog(`Laddar upp prisfil: ${file.name}`);
      const buf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const res = await fetch("/api/price-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, base64, publish: pub }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Fel vid prisimport");
      addLog(`Prisimport klar: uppdaterade ${j.updated}, misslyckades ${j.failed}.`);
    } catch (e: any) {
      addLog(`Fel: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportOne(payload: {
    sku: string;
    name?: string;
    price?: string;
    stock?: number;
    categoryId?: number;
    status?: string;
    image?: string;
  }) {
    try {
      setBusy(true);
      addLog(`Importerar produkt: ${payload.sku}`);
      const res = await fetch("/api/import-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Fel vid import");
      addLog(`OK: #${j.id} (${j.status})`);
    } catch (e: any) {
      addLog(`Fel: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // UI state – snabbimport
  const [sku, setSku] = useState("");
  const [pname, setPname] = useState("");
  const [pprice, setPprice] = useState("");
  const [pstock, setPstock] = useState<number | "">("");
  const [pcat, setPcat] = useState<number | "">("");
  const [pstatus, setPstatus] = useState<"publish" | "draft">("publish");
  const [pimg, setPimg] = useState("");

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* A: Prisfil */}
      <section className={`${brand.card} p-5`}>
        <h2 className="text-lg font-semibold mb-1">Prisfil (Excel/CSV) → WooCommerce</h2>
        <p className="text-sm opacity-70 mb-3">
          Format: <code>SKU, Pris, Lager, Status</code>. Filen skickas base64 och parsas server-side.
        </p>
        <label className="block rounded-lg border px-4 py-6 text-center cursor-pointer bg-white hover:bg-slate-50 font-semibold">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handlePriceUpload(e.target.files[0])}
          />
          {busy ? "Bearbetar…" : "Välj fil…"}
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-amber-600" checked={pub} onChange={() => setPub(!pub)} /> Publicera direkt
          (annars draft)
        </label>
      </section>

      {/* B: Snabbimport (1 produkt) */}
      <section className={`${brand.card} p-5`}>
        <h2 className="text-lg font-semibold mb-1">Britpart snabbimport (1 produkt)</h2>
        <p className="text-sm opacity-70 mb-3">Fyll i fälten (SKU = Britpart part number).</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU (obligatorisk)" className="rounded-lg border px-3 py-2 col-span-2" />
          <input value={pname} onChange={(e) => setPname(e.target.value)} placeholder="Namn" className="rounded-lg border px-3 py-2 col-span-2" />
          <input value={pprice} onChange={(e) => setPprice(e.target.value)} placeholder="Pris (SEK)" className="rounded-lg border px-3 py-2" />
          <input value={pstock as any} onChange={(e) => setPstock(e.target.value ? Number(e.target.value) : "")} placeholder="Lager" className="rounded-lg border px-3 py-2" />
          <input value={pcat as any} onChange={(e) => setPcat(e.target.value ? Number(e.target.value) : "")} placeholder="Kategori ID" className="rounded-lg border px-3 py-2" />
          <select value={pstatus} onChange={(e) => setPstatus(e.target.value as any)} className="rounded-lg border px-3 py-2">
            <option value="publish">Publicera</option>
            <option value="draft">Utkast</option>
          </select>
          <input value={pimg} onChange={(e) => setPimg(e.target.value)} placeholder="Bild-URL (valfritt)" className="rounded-lg border px-3 py-2 col-span-2" />
        </div>
        <button
          disabled={!sku || busy}
          onClick={() =>
            handleImportOne({
              sku,
              name: pname || undefined,
              price: pprice || undefined,
              stock: pstock === "" ? undefined : Number(pstock),
              categoryId: pcat === "" ? undefined : Number(pcat),
              status: pstatus,
              image: pimg || undefined,
            })
          }
          className={`mt-3 px-4 py-2 rounded-lg font-semibold ${brand.btn.secondary} disabled:opacity-50`}
        >
          Importera nu
        </button>
      </section>

      {/* C: Britpart underkategorier */}
      <section className={`${brand.card} p-5`}>
        <h2 className="text-lg font-semibold mb-1">Britpart underkategorier</h2>
        <p className="text-sm opacity-70 mb-3">Välj en eller flera och kör dry-run eller import.</p>
        <div className="h-48 overflow-auto rounded-lg border p-2 bg-white">
          {bpSubs.map((s) => (
            <label key={s.id} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                className="accent-amber-600"
                checked={selectedSubs.includes(s.id)}
                onChange={() =>
                  setSelectedSubs((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                }
              />
              <span className="truncate">{s.name}</span>
              <span className="ml-auto text-xs opacity-60">#{s.id}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button disabled={busy} onClick={() => {}} className="px-4 py-2 rounded-lg border bg-white hover:bg-slate-50 font-semibold">
            Dry-run
          </button>
          <button disabled={busy} onClick={() => {}} className={`px-4 py-2 rounded-lg font-semibold ${brand.btn.primary}`}>
            Kör import
          </button>
        </div>
      </section>

      {/* D: Logg */}
      <section className={`lg:col-span-3 ${brand.card} p-5`}>
        <h2 className="text-lg font-semibold mb-2">Logg</h2>
        <div className="h-64 overflow-auto rounded-lg border bg-slate-50 p-3 text-sm font-mono leading-relaxed">
          {log.length === 0 ? <div className="text-slate-400">Inga händelser ännu.</div> : <ul className="space-y-1">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </div>
      </section>
    </div>
  );
}