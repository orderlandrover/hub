import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/* ----------------------------- Typer ----------------------------- */
type WCProduct = {
  id: number;
  name: string;
  sku?: string;
  price: number | null;
  stock_status?: string | null;   // "instock" | "outofstock" | ...
  status?: string | null;         // "publish" | "draft" | ...
  categories: { id: number; name?: string }[];
  images?: { src: string }[];
};

type ListResponse<T> = { items: T[]; total: number; pages: number; page: number };
type WCCategory    = { id: number; name: string; parent: number };

/* ------------------------------ API ------------------------------ */
async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => "")}`);
  return (await r.json()) as T;
}

async function fetchProducts(page: number, perPage: number, search = "") {
  const url = `/api/products-list?page=${page}&per_page=${perPage}${
    search ? `&search=${encodeURIComponent(search)}` : ""
  }`;
  return jsonFetch<ListResponse<WCProduct>>(url);
}

async function fetchCategories(perPage = 500) {
  const url = `/api/wc-categories?page=1&per_page=${perPage}`;
  return jsonFetch<ListResponse<WCCategory>>(url);
}

/** Din befintliga bulk-endpoint (en kategori per anrop) */
async function bulkUpdateCategories(opts: {
  productIds: number[];
  action: "set" | "add" | "remove";
  categoryId: number;
}) {
  return jsonFetch<any>("/api/wc-products-bulk", {
    method: "POST",
    body: JSON.stringify({ ...opts }),
  });
}

/* ------------------------------ UI helpers ------------------------------ */
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">{children}</span>;
}
function Button({
  children, onClick, variant = "primary", disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost";
  disabled?: boolean;
}) {
  const styles: Record<string, string> = {
    primary: "bg-amber-500 text-white hover:bg-amber-600",
    outline: "border border-gray-300 text-gray-900 hover:bg-gray-50",
    ghost:   "text-gray-900 hover:bg-gray-100",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        // större knappar
        "px-4 py-2.5 rounded-xl text-base font-medium transition",
        styles[variant],
        disabled ? "opacity-50 cursor-not-allowed" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* ----------------------------- Utils ---------------------------- */
const fmtPrice = (v?: number | null) => (v == null ? "—" : new Intl.NumberFormat("sv-SE").format(v));
const humanStock = (s?: string | null) =>
  s === "instock" ? "i lager" : s === "outofstock" ? "slut" : s || "—";

/* ---------- Woo-lik kategoribox: bred, sökbar, bevarar scroll ---------- */
function CategoryBox({
  cats, stateSet, setState, title = "Produktkategorier",
}: {
  cats: WCCategory[];
  stateSet: Set<number>;
  setState: (s: Set<number>) => void;
  title?: string;
}) {
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);

  // bevara scrollposition mellan renders
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = scrollRef.current;
  });

  const byName = useMemo(() => {
    const xs = [...cats];
    xs.sort((a, b) => a.name.localeCompare(b.name, "sv"));
    return xs;
  }, [cats]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return byName;
    return byName.filter(c => c.name.toLowerCase().includes(s) || String(c.id).includes(s));
  }, [byName, q]);

  const toggle = (id: number) => {
    const next = new Set(stateSet);
    next.has(id) ? next.delete(id) : next.add(id);
    setState(next);
  };

  return (
    <div className="border rounded-2xl p-4 w-full max-w-none bg-white">
      <div className="sticky -top-4 bg-white pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">{title}</div>
          <div className="flex gap-3 text-sm">
            <button className="underline text-gray-700" onClick={() => setState(new Set(cats.map(c => c.id)))} type="button">
              Markera alla
            </button>
            <button className="underline text-gray-700" onClick={() => setState(new Set())} type="button">
              Avmarkera
            </button>
          </div>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Sök kategori…"
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base"
        />
      </div>

      <div
        ref={listRef}
        onScroll={e => { scrollRef.current = (e.target as HTMLDivElement).scrollTop; }}
        className="mt-3 max-h-[520px] overflow-auto pr-2"
      >
        {/* 2 kolumner på mindre, 3 på xl */}
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-x-6">
          {filtered.map(c => (
            <label key={c.id} className="flex items-center gap-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-amber-600 scale-125"
                checked={stateSet.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span className="text-base leading-6 select-none">
                <span className="font-medium">#{c.id}</span> — {c.name}
                {c.parent ? ` (parent #${c.parent})` : ""}
              </span>
            </label>
          ))}
          {!filtered.length && <div className="text-base text-gray-500 p-2 col-span-full">Inga kategorier.</div>}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- ProductsTab --------------------------- */
export default function ProductsTab() {
  // större grundtext överallt
  const [data, setData] = useState<ListResponse<WCProduct> | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [cats, setCats] = useState<WCCategory[]>([]);
  const catMap = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);

  // urval i tabellen
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const allOnPage = useMemo(() => (data?.items || []).map((p) => p.id), [data]);
  const allChecked = allOnPage.length > 0 && allOnPage.every((id) => selectedIds.includes(id));

  // Massåtgärder (Woo-stil)
  const [massAction, setMassAction] = useState<"redigera" | "trash">("redigera");
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [bulkChecked, setBulkChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  // Per produkt
  const [editId, setEditId] = useState<number | null>(null);
  const [editChecked, setEditChecked] = useState<Set<number>>(new Set());

  /* -------- Data -------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetchProducts(page, perPage, search);
        if (!alive) return;
        setData(res);
        setSelectedIds([]);  // rensa urval vid sidbyte/sök
      } catch {
        if (!alive) return;
        setData({ items: [], total: 0, pages: 1, page: 1 });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [page, perPage, search]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchCategories(500);
        setCats(Array.isArray(res?.items) ? res.items : []);
      } catch { setCats([]); }
    })();
  }, []);

  /* -------- Urval -------- */
  const toggleOne = (id: number) =>
    setSelectedIds(xs => xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id]);

  const toggleAllOnPage = () =>
    setSelectedIds(allChecked
      ? selectedIds.filter(id => !allOnPage.includes(id))
      : Array.from(new Set([...selectedIds, ...allOnPage]))
    );

  /* -------- Backend-uppdatering (exakt ersätt) -------- */
  async function applyExactCategories(productIds: number[], ids: number[]) {
    const uniq = Array.from(new Set(ids));
    if (!uniq.length) throw new Error("Välj minst en kategori.");

    // set på första → ersätt allt, därefter add för resterande
    const [first, ...rest] = uniq;
    await bulkUpdateCategories({ productIds, action: "set", categoryId: first });
    for (const cid of rest) {
      await bulkUpdateCategories({ productIds, action: "add", categoryId: cid });
    }
  }

  /* -------- Optimistic UI -------- */
  function optimisticApply(productIds: number[], ids: number[]) {
    const rows = ids.map(id => ({ id, name: catMap.get(id)?.name || `#${id}` }));
    setData(prev => {
      if (!prev) return prev;
      const nextItems = prev.items.map(p =>
        productIds.includes(p.id) ? { ...p, categories: rows } : p
      );
      return { ...prev, items: nextItems };
    });
  }

  /* -------- Tillämpa (bulk och per-rad) -------- */
  async function bulkApply() {
    if (massAction !== "redigera") return; // papperskorg ej implementerad här
    if (!selectedIds.length) return alert("Välj produkter i listan.");
    const ids = Array.from(bulkChecked);
    if (!ids.length) return alert("Välj minst en kategori.");

    try {
      setBusy(true);
      optimisticApply(selectedIds, ids);
      await applyExactCategories(selectedIds, ids);
      setShowBulkEditor(false);
      setBulkChecked(new Set());
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rowApply(productId: number) {
    const ids = Array.from(editChecked);
    if (!ids.length) return alert("Välj minst en kategori.");
    try {
      setBusy(true);
      optimisticApply([productId], ids);
      await applyExactCategories([productId], ids);
      setEditId(null);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* -------- Label -------- */
  const currentCatLabel = (rows?: { id: number; name?: string }[]) => {
    if (!rows || rows.length === 0) return "—";
    return rows.map(r => r.name || catMap.get(r.id)?.name || `#${r.id}`).join(", ");
  };

  /* -------------------------------- Render -------------------------------- */
  return (
    <div className="space-y-5 text-[15px]">
      {/* Huvudrad: Massåtgärder */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="border border-gray-300 rounded-xl px-4 py-2.5 text-base"
          value={massAction}
          onChange={(e) => setMassAction(e.target.value as any)}
        >
          <option value="redigera">Redigera</option>
          <option value="trash">Lägg i papperskorgen</option>
        </select>
        <Button
          variant="outline"
          onClick={() => { if (massAction === "redigera") setShowBulkEditor(true); }}
          disabled={!selectedIds.length}
        >
          Tillämpa
        </Button>

        <div className="ml-auto flex items-center gap-3">
          <label className="text-base text-gray-700">Sök</label>
          <input
            value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            placeholder="SKU eller namn…"
            className="border border-gray-300 rounded-xl px-4 py-2.5 text-base min-w-[260px]"
          />
          <label className="text-base text-gray-700">Per sida</label>
          <input
            type="number"
            className="w-24 border border-gray-300 rounded-xl px-4 py-2.5 text-base"
            value={perPage}
            onChange={(e) => { setPage(1); setPerPage(Math.max(10, Number(e.target.value) || 100)); }}
          />
        </div>
      </div>

      {/* MASSREDIGERA-panel – full bredd i grid */}
      {showBulkEditor && (
        <div className="border border-gray-200 rounded-2xl p-4 bg-white">
          <div className="text-base font-semibold mb-3">Massredigera</div>
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 xl:col-span-8">
              <CategoryBox cats={cats} stateSet={bulkChecked} setState={setBulkChecked} />
            </div>
            <div className="col-span-12 xl:col-span-4">
              <div className="border rounded-2xl p-4 h-full bg-gray-50 flex flex-col gap-3">
                <div className="text-lg font-semibold">Tillämpa</div>
                <div className="text-sm text-gray-600">
                  Allt som är ibockat blir produktens kategorier (ersätter tidigare).
                </div>
                <Button onClick={bulkApply} disabled={!bulkChecked.size || busy}>
                  {busy ? "Tillämpa…" : "Tillämpa"}
                </Button>
                <div className="text-sm text-gray-500">
                  Valda produkter: {selectedIds.length || 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabell */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="min-w-full text-base">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  className="accent-amber-600 scale-110"
                  checked={allChecked}
                  onChange={toggleAllOnPage}
                />
              </th>
              <th className="text-left px-4 py-3">Produkt</th>
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-left px-4 py-3">Pris</th>
              <th className="text-left px-4 py-3">Lager</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Kategorier</th>
              <th className="text-left px-4 py-3">Åtgärder</th>
              <th className="text-left px-4 py-3">ID</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((p) => {
              const editing = editId === p.id;
              return (
                <tr key={p.id} className="odd:bg-white even:bg-gray-50 align-top">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="accent-amber-600 scale-110"
                      checked={selectedIds.includes(p.id)}
                      onChange={() => toggleOne(p.id)}
                    />
                  </td>
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3 font-mono">{p.sku || "—"}</td>
                  <td className="px-4 py-3 text-right">{fmtPrice(p.price)}</td>
                  <td className="px-4 py-3">{humanStock(p.stock_status)}</td>
                  <td className="px-4 py-3">{p.status || "—"}</td>
                  <td className="px-4 py-3">{currentCatLabel(p.categories)}</td>

                  <td className="px-4 py-3">
                    {editing ? (
                      <div className="flex flex-col gap-3">
                        <CategoryBox cats={cats} stateSet={editChecked} setState={setEditChecked} title="Produktkategorier" />
                        <div className="flex gap-3">
                          <button className="px-4 py-2.5 rounded-xl border" onClick={() => rowApply(p.id)} disabled={busy}>
                            {busy ? "Tillämpa…" : "Tillämpa"}
                          </button>
                          <button className="px-4 py-2.5 rounded-xl" onClick={() => setEditId(null)}>
                            Stäng
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="px-4 py-2.5 rounded-xl border"
                        onClick={() => {
                          setEditId(p.id);
                          setEditChecked(new Set((p.categories || []).map(c => c.id)));
                        }}
                      >
                        Redigera kategorier
                      </button>
                    )}
                  </td>

                  <td className="px-4 py-3 font-mono">{p.id}</td>
                </tr>
              );
            })}
            {!loading && (data?.items || []).length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-gray-500" colSpan={9}>
                  Inga produkter funna.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginering */}
      {!!data && (
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
            Föregående
          </Button>
          <Badge>Sida {data.page} / {data.pages}</Badge>
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.min(data.pages || 1, p + 1))}
            disabled={page >= (data.pages || 1) || loading}
          >
            Nästa
          </Button>
          <span className="ml-2 text-sm text-gray-600">Totalt: {data.total}</span>
        </div>
      )}
    </div>
  );
}
