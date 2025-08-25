import React, { useEffect, useMemo, useRef, useState } from "react";
import "./brand.css";

/* ------------------------------------------------------------------ */
/*                              Typer                                  */
/* ------------------------------------------------------------------ */

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
type RoundModeUI = "nearest" | "up" | "down" | "none";

/* ------------------------------------------------------------------ */
/*                          Normaliserare                              */
/* ------------------------------------------------------------------ */

function normalizeList(raw: any): ListResponse {
  if (Array.isArray(raw)) {
    return { items: raw as WCProduct[], total: raw.length, pages: 1, page: 1 };
  }
  const items: WCProduct[] =
    Array.isArray(raw?.items) ? raw.items :
    Array.isArray(raw?.parts) ? raw.parts : [];
  const total = Number(raw?.total ?? items.length ?? 0);
  const pages = Number(raw?.pages ?? raw?.totalPages ?? 1);
  const page  = Number(raw?.page ?? 1);
  return { items, total, pages, page };
}

function normalizeCategories(raw: any): WCCategory[] {
  if (Array.isArray(raw)) return raw as WCCategory[];
  if (Array.isArray(raw?.items)) return raw.items as WCCategory[];
  return [];
}

/* ------------------------------------------------------------------ */
/*                         Små hjälpare                                */
/* ------------------------------------------------------------------ */

async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

const brand = {
  card: "bg-white rounded-2xl shadow-sm border",
  chip: "inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize",
};

/* =================================================================== */
/*                                App                                   */
/* =================================================================== */

export default function App(): React.ReactElement {
  const [tab, setTab] = useState<"products" | "import">("products");

  const header = useMemo(
    () => (
      <header className="ui-header sticky top-0 z-20 shadow">
        <div className="w-full px-6 py-4 flex items-center justify-between">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            Björklin Motor - Landrover
          </h1>
          <a
            href="https://landroverdelar.se"
            className="text-sm opacity-80 hover:opacity-100"
            rel="noreferrer"
          >
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
        <div className="mb-6 flex gap-2">
          <button className="px-4 py-2 rounded-lg ui-btn" onClick={() => setTab("products")}>
            Produkter
          </button>
          <button className="px-4 py-2 rounded-lg ui-btn" onClick={() => setTab("import")}>
            Import & synk
          </button>
        </div>

        {tab === "products" ? <ProductsTab /> : <ImportTab />}
      </main>
    </div>
  );
}

/* =================================================================== */
/*                          Flik 1 – Produkter                          */
/* =================================================================== */

function ProductsTab(): React.ReactElement {
  // Filter
  const [status, setStatus] = useState<string>("any");
  const [search, setSearch] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [orderby, setOrderby] = useState<"title" | "date" | "id" | "price">("title");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [perPage, setPerPage] = useState<number>(100);
  const [page, setPage] = useState<number>(1);

  // Data
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<ListResponse>({ items: [], total: 0, pages: 0, page: 1 });
  const [selected, setSelected] = useState<number[]>([]);
  const [cats, setCats] = useState<WCCategory[]>([]);
  const ctrlRef = useRef<AbortController | null>(null);

  const canPrev = page > 1;
  const canNext = page < (data.pages || 1);
  const items = data?.items ?? [];

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
      const json = await res.json();
      setData(normalizeList(json));
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
      const json = await res.json();
      setCats(normalizeCategories(json));
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
    setSelected((s) =>
      s.length === items.length && items.length > 0 ? [] : items.map((p) => p.id)
    );
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
              className="px-4 py-2 rounded-lg ui-btn"
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
              className="px-4 py-2 rounded-lg ui-btn"
              disabled={loading}
            >
              Rensa
            </button>
          </div>

          <div className="xl:col-span-12 grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">Sortera:</span>
              <select
                value={orderby}
                onChange={(e) => setOrderby(e.target.value as any)}
                className="rounded-lg border px-2 py-1"
              >
                <option value="title">Titel</option>
                <option value="price">Pris</option>
                <option value="date">Datum</option>
                <option value="id">ID</option>
              </select>
              <select
                value={order}
                onChange={(e) => setOrder(e.target.value as any)}
                className="rounded-lg border px-2 py-1"
              >
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
          className="px-4 py-2 rounded-lg ui-btn"
        >
          Publicera
        </button>
        <button
          disabled={selected.length === 0 || loading}
          onClick={() => bulkUpdate({ status: "draft" })}
          className="px-4 py-2 rounded-lg ui-btn"
        >
          Avpublicera
        </button>
        <button
          disabled={selected.length === 0 || loading}
          onClick={askNewPrice}
          className="px-4 py-2 rounded-lg ui-btn"
        >
          Nytt pris (SEK)
        </button>
        <button
          disabled={selected.length === 0 || loading}
          onClick={assignCategory}
          className="px-4 py-2 rounded-lg ui-btn"
        >
          Sätt kategori
        </button>
        <button
          disabled={selected.length === 0 || loading}
          onClick={bulkDelete}
          className="ml-auto px-4 py-2 rounded-lg ui-btn ui-btn--danger"
        >
          Radera
        </button>
        <span className="text-sm opacity-70">Valda: {selected.length}</span>
      </section>

      {/* Tabell */}
      <section className={`${brand.card} overflow-auto`}>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr className="[&>th]:p-3 [&>th]:text-left">
              <th className="w-10">
                <input
                  type="checkbox"
                  onChange={toggleAllOnPage}
                  checked={items.length > 0 && selected.length === items.length}
                />
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
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center">
                  Inga produkter
                </td>
              </tr>
            )}
            {!loading &&
              items.map((p) => (
                <tr key={p.id} className="border-t align-middle">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  </td>
                  <td className="p-3 min-w-[320px]">
                    <div className="flex items-center gap-3">
                      {p.images?.[0]?.src && (
                        <img
                          src={p.images[0].src}
                          alt=""
                          className="w-10 h-10 object-cover rounded-lg border"
                        />
                      )}
                      <span className="font-medium leading-tight">
                        {p.name || "(namnlös)"}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 font-mono">{p.sku || "—"}</td>
                  <td className="p-3">{p.regular_price ?? "—"}</td>
                  <td className="p-3">
                    {p.stock_quantity ?? "—"}{" "}
                    {p.stock_status && (
                      <span className="ml-1 opacity-60">({p.stock_status})</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={brand.chip}>{p.status}</span>
                  </td>
                  <td className="p-3">
                    {p.categories?.[0]?.id ? `#${p.categories[0].id}` : "—"}
                  </td>
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

/* =================================================================== */
/*                         Flik 2 – Import & synk                       */
/* =================================================================== */

function ImportTab(): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [pub, setPub] = useState(true);

  // Prisberäkning
  const [fx, setFx] = useState<number>(13.5);
  const [markup, setMarkup] = useState<number>(25);
  const [roundMode, setRoundMode] = useState<RoundModeUI>("nearest");
  const [roundStep, setRoundStep] = useState<number>(1);
  const [dry, setDry] = useState<boolean>(true);

  // Britpart underkategorier
  type BPSub = { id: number; name: string };
  const [bpSubs, setBpSubs] = useState<BPSub[]>([]);
  const [selectedSubs, setSelectedSubs] = useState<number[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/britpart-subcategories");
        if (!res.ok) throw new Error(await res.text());
        const j = await res.json();
        const items: BPSub[] = Array.isArray(j?.items)
          ? j.items.map((x: any) => ({ id: Number(x.id), name: String(x.name ?? x.title ?? x.id) }))
          : [];
        setBpSubs(items);
      } catch (e) {
        addLog(`Fel att hämta underkategorier: ${(e as any)?.message ?? e}`);
      }
    })();
  }, []);

  function addLog(s: string) {
    const stamp = new Date().toLocaleString();
    setLog((prev) => [`[${stamp}] ${s}`, ...prev].slice(0, 500));
  }

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }
    if (!res.ok) throw new Error(json?.error || text || `HTTP ${res.status}`);
    return json as T;
  }

  // ---- Prisfil
  async function handlePriceUpload(file: File) {
    try {
      setBusy(true);
      addLog(`Laddar upp prisfil: ${file.name}`);

      const base64 = await fileToBase64(file);
      const apiRoundMode = roundMode === "nearest" ? "near" : roundMode;

      const res = await fetch("/api/price-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          base64,
          fx: Number(fx),
          markupPct: Number(markup),
          roundMode: apiRoundMode,
          step: Number(roundStep),
          publish: !!pub,
          dryRun: !!dry,
        }),
      });

      const txt = await res.text();
      const j = txt ? JSON.parse(txt) : {};
      if (!res.ok) throw new Error(j?.error || txt || "Fel vid prisimport");

      addLog(
        `Prisimport OK: total=${j.total}, updated=${j.updated}, skipped=${j.skipped}, notFound=${j.notFound}, errors=${j.errors}`
      );
      if (j.sample?.updates?.length) addLog(`Exempel uppdateringar: ${j.sample.updates.length} st`);
      if (j.sample?.errors?.length) addLog(`Exempel fel: ${j.sample.errors.length} st`);
    } catch (e: any) {
      addLog(`Fel: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // ---- Britpart dry-run / import
  function ensureIds(): number[] {
    const ids = selectedSubs.map((n) => Number(n)).filter(Number.isFinite);
    if (!ids.length) addLog("Välj minst en underkategori.");
    return ids;
  }

  async function handleDryRun() {
    const ids = ensureIds();
    if (!ids.length) return;

    try {
      setBusy(true);
      addLog(`Dry-run: ${ids.join(", ")}`);
      // VIKTIGT: backend vill ha { categoryIds }
      const j = await postJson<any>("/api/import-dry-run", { categoryIds: ids });

      const create = j?.summary?.create ?? j?.create ?? 0;
      const update = j?.summary?.update ?? j?.update ?? 0;
      const skip   = j?.summary?.skip   ?? j?.skip   ?? 0;
      const total  = j?.summary?.total  ?? j?.total  ?? create + update + skip;

      addLog(`Dry-run OK – total:${total}, skapa:${create}, uppdatera:${update}, hoppa över:${skip}`);
      if (Array.isArray(j?.sample) && j.sample.length) {
        const peek = j.sample.slice(0, 5).map((x: any) => x?.sku || x?.id || "?").join(", ");
        addLog(`Exempel: ${peek}${j.sample.length > 5 ? " …" : ""}`);
      }
    } catch (e: any) {
      addLog(`Fel i dry-run: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    const ids = ensureIds();
    if (!ids.length) return;

    try {
      setBusy(true);
      addLog(`Kör import: ${ids.join(", ")}`);
      const j = await postJson<any>("/api/import-run", { categoryIds: ids, publish: true });

      const created = j?.created ?? j?.create ?? 0;
      const updated = j?.updated ?? j?.update ?? 0;
      const skipped = j?.skipped ?? j?.skip ?? 0;
      const total   = j?.total ?? created + updated + skipped;
      addLog(`Import OK – total:${total}, created:${created}, updated:${updated}, skipped:${skipped}`);
      if (j?.jobId) addLog(`Jobb-id: ${j.jobId}`);
    } catch (e: any) {
      addLog(`Fel i import: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // ---- Snabbimport (1 produkt)
  const [sku, setSku] = useState("");
  const [pname, setPname] = useState("");
  const [pprice, setPprice] = useState("");
  const [pstock, setPstock] = useState<number | "">("");
  const [pcat, setPcat] = useState<number | "">("");
  const [pstatus, setPstatus] = useState<"publish" | "draft">("publish");
  const [pimg, setPimg] = useState("");

  async function handleImportOne() {
    try {
      setBusy(true);
      addLog(`Importerar produkt: ${sku}`);
      const res = await fetch("/api/import-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          name: pname || undefined,
          price: pprice || undefined,
          stock: pstock === "" ? undefined : Number(pstock),
          categoryId: pcat === "" ? undefined : Number(pcat),
          status: pstatus,
          image: pimg || undefined,
        }),
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

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* A: Prisfil */}
      <section className={`${brand.card} p-5`}>
        <h2 className="text-lg font-semibold mb-1">Prisfil (Excel/CSV) → WooCommerce</h2>
        <p className="text-sm opacity-70 mb-3">
          Matchar på <b>SKU</b>. Räknar pris = GBP × valutakurs × (1 + påslag%) och avrundar.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div>
            <label className="text-xs opacity-70">Valutakurs (GBP→SEK)</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border px-3 py-2"
              value={fx}
              onChange={(e) => setFx(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-xs opacity-70">Påslag (%)</label>
            <input
              type="number"
              step="0.1"
              className="w-full rounded-lg border px-3 py-2"
              value={markup}
              onChange={(e) => setMarkup(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-xs opacity-70">Avrundning</label>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={roundMode}
              onChange={(e) => setRoundMode(e.target.value as RoundModeUI)}
            >
              <option value="nearest">Närmaste</option>
              <option value="up">Uppåt</option>
              <option value="down">Nedåt</option>
              <option value="none">Ingen</option>
            </select>
          </div>
          <div>
            <label className="text-xs opacity-70">Steg (SEK)</label>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={roundStep}
              onChange={(e) => setRoundStep(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </div>
        </div>

        <label className="block rounded-lg border px-4 py-6 text-center cursor-pointer bg-white hover:bg-slate-50 font-semibold">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handlePriceUpload(e.target.files[0])}
          />
          {busy ? "Bearbetar…" : "Välj fil…"}
        </label>

        <div className="mt-3 flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-amber-600" checked={pub} onChange={() => setPub(!pub)} />
            Publicera direkt (annars draft)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-amber-600" checked={dry} onChange={() => setDry(!dry)} />
            Dry-run (visa bara vad som skulle ändras)
          </label>
        </div>
      </section>

      {/* B: Snabbimport (1 produkt) */}
      <section className={`${brand.card} p-5`}>
        <h2 className="text-lg font-semibold mb-1">Britpart snabbimport (1 produkt)</h2>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="SKU (obligatorisk)"
            className="rounded-lg border px-3 py-2 col-span-2"
          />
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
          onClick={handleImportOne}
          className="mt-3 px-4 py-2 rounded-lg border bg-white hover:bg-slate-50 font-semibold disabled:opacity-50"
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
                  setSelectedSubs((prev) =>
                    prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                  )
                }
              />
              <span className="truncate">{s.name}</span>
              <span className="ml-auto text-xs opacity-60">#{s.id}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className="px-4 py-2 rounded-lg ui-btn" disabled={!selectedSubs.length || busy} onClick={handleDryRun}>
            Dry-run
          </button>
          <button className="px-4 py-2 rounded-lg ui-btn" disabled={!selectedSubs.length || busy} onClick={handleImport}>
            Kör import
          </button>
        </div>
      </section>

      {/* D: Logg */}
      <section className="lg:col-span-3 bg-white rounded-2xl shadow-sm border p-5">
        <h2 className="text-lg font-semibold mb-2">Logg</h2>
        <div className="h-64 overflow-auto rounded-lg border bg-slate-50 p-3 text-sm font-mono leading-relaxed">
          {log.length === 0 ? (
            <div className="text-slate-400">Inga händelser ännu.</div>
          ) : (
            <ul className="space-y-1">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
          )}
        </div>
      </section>
    </div>
  );
}