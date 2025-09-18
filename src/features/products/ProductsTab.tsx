import React, { useEffect, useMemo, useState } from "react";

/* ----------------------------- Typer ----------------------------- */
type WCProduct = {
  id: number;
  name: string;
  sku?: string;
  price?: number | string;
  stock_status?: string;
  categories?: { id: number; name?: string }[];
  images?: { src: string }[];
  status?: string;
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
  const url = `/api/products-list?page=${page}&per_page=${perPage}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
  return jsonFetch<ListResponse<WCProduct>>(url);
}

async function fetchCategories(perPage = 100) {
  // Hämtar första sidan; hos er finns ~30 st så 100 räcker gott.
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

/* --------------------------- ProductsTab --------------------------- */
export default function ProductsTab() {
  const [data, setData] = useState<ListResponse<WCProduct> | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [cats, setCats] = useState<WCCategory[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);

  // urval
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const allOnPage = useMemo(() => (data?.items || []).map(p => p.id), [data]);
  const allChecked = allOnPage.length > 0 && allOnPage.every(id => selectedIds.includes(id));

  // bulk-kontroller
  const [action, setAction] = useState<"set" | "add" | "remove">("set");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [running, setRunning] = useState(false);

  // hämta produkter
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetchProducts(page, perPage, search);
        if (!alive) return;
        setData(res);
        setSelectedIds([]); // töm urval vid sidbyte
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

  // hämta kategorier
  useEffect(() => {
    (async () => {
      try {
        setCatsLoading(true);
        const res = await fetchCategories(200);
        setCats(Array.isArray(res?.items) ? res.items : []);
      } catch (e) {
        console.error(e);
        setCats([]);
      } finally {
        setCatsLoading(false);
      }
    })();
  }, []);

  const toggleOne = (id: number) =>
    setSelectedIds(xs => (xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id]));

  const toggleAllOnPage = () =>
    setSelectedIds(allChecked ? selectedIds.filter(id => !allOnPage.includes(id)) : Array.from(new Set([...selectedIds, ...allOnPage])));

  const currentCatLabel = (ids?: { id: number }[]) =>
    (ids || []).map(c => `#${c.id}`).join(", ") || "—";

  const doBulkUpdate = async () => {
    if (!selectedIds.length) return alert("Välj minst en produkt.");
    if (!categoryId) return alert("Välj en Woo-kategori.");
    try {
      setRunning(true);
      const res = await bulkUpdateCategories({ productIds: selectedIds, action, categoryId });
      console.log("bulk result", res);

      const updated = Number(res?.updated || 0);
      const failed = Array.isArray(res?.failedIds) ? res.failedIds.length : 0;
      const skipped = Array.isArray(res?.skipped) ? res.skipped.length : 0;

      alert(`Klart.
Uppdaterade: ${updated}
Hoppade över (ingen ändring behövdes): ${skipped}
Misslyckade: ${failed}`);

      // Ladda om sidan vi står på för att se nya kategorier
      const refreshed = await fetchProducts(page, perPage, search);
      setData(refreshed);
      setSelectedIds([]);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Bulk-panel */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Åtgärd</label>
          <select
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm"
            value={action}
            onChange={e => setAction(e.target.value as any)}
            disabled={running}
          >
            <option value="set">Byt till (ersätt)</option>
            <option value="add">Lägg till</option>
            <option value="remove">Ta bort</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Woo-kategori</label>
          <select
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm min-w-[220px]"
            value={categoryId}
            onChange={e => setCategoryId(Number(e.target.value) || 0)}
            disabled={catsLoading || running}
          >
            <option value={0} disabled>— Välj kategori —</option>
            {cats.map(c => (
              <option key={c.id} value={c.id}>
                #{c.id} — {c.name}{c.parent ? ` (parent #${c.parent})` : ""}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={doBulkUpdate} disabled={running || !selectedIds.length || !categoryId}>
          {running ? "Uppdaterar…" : `Uppdatera ${selectedIds.length} valda`}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Sök</label>
          <input
            value={search}
            onChange={e => { setPage(1); setSearch(e.target.value); }}
            placeholder="SKU eller namn…"
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm"
          />
          <label className="text-sm text-gray-600">Per sida</label>
          <input
            type="number"
            className="w-20 border border-gray-300 rounded-xl px-3 py-2 text-sm"
            value={perPage}
            onChange={e => { setPage(1); setPerPage(Math.max(10, Number(e.target.value) || 100)); }}
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
              <th className="text-left px-3 py-2">ID</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map(p => (
              <tr key={p.id} className="odd:bg-white even:bg-gray-50">
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
                <td className="px-3 py-2">{p.price ?? "—"}</td>
                <td className="px-3 py-2">{p.stock_status || "—"}</td>
                <td className="px-3 py-2">{p.status || "—"}</td>
                <td className="px-3 py-2">{currentCatLabel(p.categories)}</td>
                <td className="px-3 py-2 font-mono">{p.id}</td>
              </tr>
            ))}
            {!loading && (data?.items || []).length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={8}>Inga produkter funna.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginering */}
      {!!data && (
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
            Föregående
          </Button>
          <Badge>Sida {data.page} / {data.pages}</Badge>
          <Button
            variant="outline"
            onClick={() => setPage(p => Math.min(data.pages || 1, p + 1))}
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
