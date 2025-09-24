import React, { useEffect, useMemo, useState } from "react";
import CategoryPicker from "../../components/CategoryPicker";
import type { WCCategory as PickerWCCategory } from "../../components/CategoryPicker";

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

// Håller din gamla typ (kompatibel med pickerns)
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

async function fetchCategories(perPage = 200) {
  const url = `/api/wc-categories?page=1&per_page=${perPage}`;
  return jsonFetch<ListResponse<WCCategory>>(url);
}

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

  // urval
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const allOnPage = useMemo(() => (data?.items || []).map((p) => p.id), [data]);
  const allChecked = allOnPage.length > 0 && allOnPage.every((id) => selectedIds.includes(id));

  // bulk-kontroller
  const [action, setAction] = useState<"set" | "add" | "remove">("set");
  const [bulkCatIds, setBulkCatIds] = useState<number[]>([]);
  const [running, setRunning] = useState(false);

  // per-produkt editor
  const [editId, setEditId] = useState<number | null>(null);
  const [editCatIds, setEditCatIds] = useState<number[]>([]);

  // kategori lookup
  const catMap = useMemo(() => {
    const m = new Map<number, WCCategory>();
    for (const c of cats) m.set(c.id, c);
    return m;
  }, [cats]);

  // hämta produkter
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetchProducts(page, perPage, search);
        if (!alive) return;
        setData(res);
        setSelectedIds([]); // töm urval vid sidbyte/sök
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setData({ items: [], total: 0, pages: 1, page: 1 });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [page, perPage, search]);

  // hämta kategorier (en gång)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetchCategories(200);
        setCats(Array.isArray(res?.items) ? res.items : []);
      } catch (e) {
        console.error(e);
        setCats([]);
      }
    })();
  }, []);

  const toggleOne = (id: number) =>
    setSelectedIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const toggleAllOnPage = () =>
    setSelectedIds(
      allChecked ? selectedIds.filter((id) => !allOnPage.includes(id)) : Array.from(new Set([...selectedIds, ...allOnPage]))
    );

  // visa kategori-namn snyggt
  const currentCatLabel = (rows?: { id: number; name?: string }[]) => {
    if (!rows || rows.length === 0) return "—";
    const parts = rows.map((r) => {
      if (r.name) return r.name;
      const c = catMap.get(r.id);
      return c?.name ? c.name : `#${r.id}`;
    });
    return parts.join(", ");
  };

  // hjälp: loopa flera kategori-IDs mot din befintliga bulk-endpoint (en kategori per anrop)
  async function bulkUpdateMany(productIds: number[], categoryIds: number[], act: "set"|"add"|"remove") {
    let updated = 0, failed: number[] = [], skipped: number[] = [];
    for (const cid of categoryIds) {
      try {
        const res = await bulkUpdateCategories({ productIds, action: act, categoryId: cid });
        updated += Number(res?.updated || 0);
        if (Array.isArray(res?.failedIds)) failed.push(...res.failedIds);
        if (Array.isArray(res?.skipped)) skipped.push(...res.skipped);
      } catch {
        failed.push(...productIds);
      }
    }
    return { updated, failed, skipped };
  }

  const doBulkUpdate = async () => {
    if (!selectedIds.length) return alert("Välj minst en produkt.");
    if (!bulkCatIds.length) return alert("Välj minst en Woo-kategori.");
    try {
      setRunning(true);
      const { updated, failed, skipped } = await bulkUpdateMany(selectedIds, bulkCatIds, action);
      alert(`Klart.\nUppdaterade: ${updated}\nHoppade över: ${skipped.length}\nMisslyckade: ${failed.length}`);

      // ladda om sidan vi står på för att se nya kategorier
      const refreshed = await fetchProducts(page, perPage, search);
      setData(refreshed);
      setSelectedIds([]);
      setBulkCatIds([]);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  async function saveRow(id: number, catsToApply: number[], act: "set"|"add"|"remove") {
    try {
      setRunning(true);
      await bulkUpdateMany([id], catsToApply, act);
      setEditId(null);
      const refreshed = await fetchProducts(page, perPage, search);
      setData(refreshed);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Bulk-panel */}
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Åtgärd</label>
          <select
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value as any)}
            disabled={running}
          >
            <option value="set">Byt till (ersätt)</option>
            <option value="add">Lägg till</option>
            <option value="remove">Ta bort</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Woo-kategorier (flera)</label>
          <CategoryPicker
            allCategories={cats as unknown as PickerWCCategory[]}
            value={bulkCatIds}
            onChange={setBulkCatIds}
          />
        </div>

        <div className="flex flex-col gap-2 pt-6">
          <Button onClick={doBulkUpdate} disabled={running || !selectedIds.length || !bulkCatIds.length}>
            {running ? "Uppdaterar…" : `Uppdatera ${selectedIds.length} valda`}
          </Button>
          <div className="text-xs text-gray-500">
            Valda produkter: {selectedIds.length || 0}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Sök</label>
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="SKU eller namn…"
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm"
          />
          <label className="text-sm text-gray-600">Per sida</label>
          <input
            type="number"
            className="w-20 border border-gray-300 rounded-xl px-3 py-2 text-sm"
            value={perPage}
            onChange={(e) => {
              setPage(1);
              setPerPage(Math.max(10, Number(e.target.value) || 100));
            }}
          />
        </div>
      </div>

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
              <th className="text-left px-3 py-2">Kategori</th>
              <th className="text-left px-3 py-2">Redigera</th>
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
                        <CategoryPicker
                          allCategories={cats as unknown as PickerWCCategory[]}
                          value={editCatIds}
                          onChange={setEditCatIds}
                        />
                        <div className="flex flex-col gap-1">
                          <button
                            className="px-3 py-2 rounded-xl border"
                            onClick={() => saveRow(p.id, editCatIds, "set")}
                            disabled={running}
                          >
                            Spara (ersätt)
                          </button>
                          <button
                            className="px-3 py-2 rounded-xl border"
                            onClick={() => saveRow(p.id, editCatIds, "add")}
                            disabled={running}
                          >
                            Lägg till
                          </button>
                          <button
                            className="px-3 py-2 rounded-xl border"
                            onClick={() => saveRow(p.id, editCatIds, "remove")}
                            disabled={running}
                          >
                            Ta bort
                          </button>
                          <button
                            className="px-3 py-2 rounded-xl"
                            onClick={() => setEditId(null)}
                          >
                            Stäng
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="px-3 py-2 rounded-xl border"
                        onClick={() => {
                          setEditId(p.id);
                          setEditCatIds((p.categories || []).map((c) => c.id));
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
          <Badge>
            Sida {data.page} / {data.pages}
          </Badge>
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
