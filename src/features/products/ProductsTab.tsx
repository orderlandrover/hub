import React, { useEffect, useMemo, useState } from "react";

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
type WCCategory = { id: number; name: string; parent: number };

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

/** Din befintliga bulk-endpoint: tar EN categoryId åt gången */
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

/* ------------------------------ UI ------------------------------ */
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">{children}</span>;
}
function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost";
  disabled?: boolean;
}) {
  const styles: Record<string, string> = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    outline: "border border-gray-300 text-gray-900 hover:bg-gray-50",
    ghost: "text-gray-900 hover:bg-gray-100",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "px-3 py-2 rounded-xl text-sm font-medium transition",
        styles[variant],
        disabled ? "opacity-50 cursor-not-allowed" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* ----------------------------- Helpers ---------------------------- */
const fmtPrice = (v?: number | null) => (v == null ? "—" : new Intl.NumberFormat("sv-SE").format(v));
const humanStock = (s?: string | null) =>
  s === "instock" ? "i lager" : s === "outofstock" ? "slut" : s || "—";

/* --------------------------- ProductsTab --------------------------- */
export default function ProductsTab() {
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

  // Per produkt
  const [editId, setEditId] = useState<number | null>(null);
  const [editChecked, setEditChecked] = useState<Set<number>>(new Set());

  // laddning av data
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

  // urval helpers
  const toggleOne = (id: number) =>
    setSelectedIds(xs => xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id]);

  const toggleAllOnPage = () =>
    setSelectedIds(allChecked
      ? selectedIds.filter(id => !allOnPage.includes(id))
      : Array.from(new Set([...selectedIds, ...allOnPage]))
    );

  // renderar Woo-lik checkbox-lista
  function CategoryBox({
    stateSet, setState,
  }: { stateSet: Set<number>; setState: (s: Set<number>) => void }) {
    const toggle = (id: number) => {
      const next = new Set(stateSet);
      next.has(id) ? next.delete(id) : next.add(id);
      setState(next);
    };
    return (
      <div className="border rounded-xl p-2 w-[360px] max-w-full">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Produktkategorier</div>
          <div className="flex gap-2 text-xs">
            <button className="underline text-gray-600" type="button"
              onClick={() => setState(new Set(cats.map(c => c.id)))}>Markera alla</button>
            <button className="underline text-gray-600" type="button"
              onClick={() => setState(new Set())}>Avmarkera</button>
          </div>
        </div>
        <div className="max-h-64 overflow-auto space-y-1 pr-1">
          {cats.map(c => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={stateSet.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span className="text-sm">#{c.id} — {c.name}{c.parent ? ` (parent #${c.parent})` : ""}</span>
            </label>
          ))}
          {!cats.length && <div className="text-sm text-gray-500 p-2">Inga kategorier.</div>}
        </div>
      </div>
    );
  }

  // Woo-beteende: allt ibockat BLIR produktens kategorier (ersätt)
  async function applyExactCategories(productIds: number[], ids: number[]) {
    if (!ids.length) throw new Error("Välj minst en kategori.");
    const [first, ...rest] = ids;
    await bulkUpdateCategories({ productIds, action: "set", categoryId: first });
    for (const cid of rest) {
      await bulkUpdateCategories({ productIds, action: "add", categoryId: cid });
    }
  }

  async function bulkApply() {
    if (massAction !== "redigera") return; // (vi har inte implementerat papperskorg)
    if (!selectedIds.length) return alert("Välj produkter i listan.");
    const ids = Array.from(bulkChecked);
    if (!ids.length) return alert("Välj minst en kategori.");

    await applyExactCategories(selectedIds, ids);
    alert(`Tillämpat på ${selectedIds.length} produkter.`);
    setShowBulkEditor(false);
    setBulkChecked(new Set());
    const refreshed = await fetchProducts(page, perPage, search);
    setData(refreshed);
    setSelectedIds([]);
  }

  async function rowApply(productId: number) {
    const ids = Array.from(editChecked);
    if (!ids.length) return alert("Välj minst en kategori.");

    await applyExactCategories([productId], ids);
    setEditId(null);
    const refreshed = await fetchProducts(page, perPage, search);
    setData(refreshed);
  }

  // läsbar label
  const currentCatLabel = (rows?: { id: number; name?: string }[]) => {
    if (!rows || rows.length === 0) return "—";
    return rows.map(r => r.name || catMap.get(r.id)?.name || `#${r.id}`).join(", ");
  };

  return (
    <div className="space-y-4">
      {/* Woo-huvudrad: Massåtgärder */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm"
          value={massAction}
          onChange={(e) => setMassAction(e.target.value as any)}
        >
          <option value="redigera">Redigera</option>
          <option value="trash">Lägg i papperskorgen</option>
        </select>
        <Button
          variant="outline"
          onClick={() => {
            if (massAction === "redigera") setShowBulkEditor(true);
          }}
          disabled={!selectedIds.length}
        >
          Tillämpa
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Sök</label>
          <input
            value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            placeholder="SKU eller namn…"
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm"
          />
          <label className="text-sm text-gray-600">Per sida</label>
          <input
            type="number"
            className="w-20 border border-gray-300 rounded-xl px-3 py-2 text-sm"
            value={perPage}
            onChange={(e) => { setPage(1); setPerPage(Math.max(10, Number(e.target.value) || 100)); }}
          />
        </div>
      </div>

      {/* MASSREDIGERA-panel (Woo-stil) */}
      {showBulkEditor && (
        <div className="border border-gray-200 rounded-xl p-3 bg-white">
          <div className="text-sm font-semibold mb-2">Massredigera</div>
          <div className="flex flex-wrap items-start gap-3">
            <CategoryBox stateSet={bulkChecked} setState={setBulkChecked} />
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={bulkApply} disabled={!bulkChecked.size}>
                Tillämpa
              </Button>
              <div className="text-xs text-gray-500">
                Allt som är ibockat blir produktens kategorier (ersätter tidigare).
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabell */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  className="accent-indigo-600"
                  checked={allChecked}
                  onChange={toggleAllOnPage}
                />
              </th>
              <th className="text-left px-3 py-2">Produkt</th>
              <th className="text-left px-3 py-2">SKU</th>
              <th className="text-left px-3 py-2">Pris</th>
              <th className="text-left px-3 py-2">Lager</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Kategorier</th>
              <th className="text-left px-3 py-2">Åtgärder</th>
              <th className="text-left px-3 py-2">ID</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((p) => {
              const editing = editId === p.id;
              return (
                <tr key={p.id} className="odd:bg-white even:bg-gray-50 align-top">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="accent-indigo-600"
                      checked={selectedIds.includes(p.id)}
                      onChange={() => toggleOne(p.id)}
                    />
                  </td>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 font-mono">{p.sku || "—"}</td>
                  <td className="px-3 py-2 text-right">{fmtPrice(p.price)}</td>
                  <td className="px-3 py-2">{humanStock(p.stock_status)}</td>
                  <td className="px-3 py-2">{p.status || "—"}</td>
                  <td className="px-3 py-2">{currentCatLabel(p.categories)}</td>

                  <td className="px-3 py-2">
                    {editing ? (
                      <div className="flex items-start gap-2">
                        <CategoryBox stateSet={editChecked} setState={setEditChecked} />
                        <div className="flex flex-col gap-1 pt-1">
                          <button className="px-3 py-2 rounded-xl border" onClick={() => rowApply(p.id)}>
                            Tillämpa
                          </button>
                          <button className="px-3 py-2 rounded-xl" onClick={() => setEditId(null)}>
                            Stäng
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="px-3 py-2 rounded-xl border"
                        onClick={() => {
                          setEditId(p.id);
                          setEditChecked(new Set((p.categories || []).map(c => c.id)));
                        }}
                      >
                        Redigera kategorier
                      </button>
                    )}
                  </td>

                  <td className="px-3 py-2 font-mono">{p.id}</td>
                </tr>
              );
            })}
            {!loading && (data?.items || []).length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={9}>
                  Inga produkter funna.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginering */}
      {!!data && (
        <div className="flex items-center gap-2">
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
          <span className="ml-2 text-xs text-gray-500">Totalt: {data.total}</span>
        </div>
      )}
    </div>
  );
}
