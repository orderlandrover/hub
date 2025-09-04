// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import "./brand.css";
import SASPriceImport from "./features/britpart/SASPriceImport";
import ProductsTab from "./features/products/ProductsTab";

/* ----------------------------- Typer ----------------------------- */
type Subcategory = { id: number; title: string; parentId?: number };
type ListResponse<T> = { items: T[]; total: number; pages: number; page: number };
type WCCategory = { id: number; name: string; parent: number };

type ImportRunResult = {
  ok: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ sku?: string; id?: number; error: string }>;
  sample: any[];
  error?: string;
};

/* --------------------------- Utils / UI --------------------------- */
const API = {
  BRITPART_SUBCATS: "/api/britpart-subcategories",
  WC_CATEGORIES: "/api/wc-categories",
  IMPORT_RUN: "/api/import-run",
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => "")}`);
  return (await r.json()) as T;
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={classNames("px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700", className)}>
      {children}
    </span>
  );
}

// Knapp som forwardar alla props till <button> och sätter type="button"
function Button({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { disabled } = props;
  return (
    <button
      type={props.type ?? "button"}
      {...props}
      className={classNames(
        "ui-btn px-3 py-2 rounded-xl text-sm font-semibold transition",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    />
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow p-5 border border-gray-200">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* ----------------------- Subcategory selector ----------------------- */
function SubcategorySelector({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [subcats, setSubcats] = useState<Subcategory[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await jsonFetch<any>(API.BRITPART_SUBCATS);

        const raw: any[] =
          Array.isArray(res?.items) ? res.items :
          Array.isArray(res?.children) ? res.children :
          Array.isArray(res) ? res : [];

        const normalized = raw.map((c: any) => ({
          id: Number(c.id),
          title: String(c.title ?? c.name ?? c.id),
          parentId: typeof c.parentId === "number" ? c.parentId : undefined,
        }));
        const sorted = normalized.sort((a, b) => a.title.localeCompare(b.title, "sv"));
        if (alive) setSubcats(sorted);
      } catch (e) {
        console.error(e);
        if (alive) setSubcats([]); // fail safe
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!subcats) return [];
    if (!s) return subcats;
    return subcats.filter((x) => x.title.toLowerCase().includes(s) || String(x.id).includes(s));
  }, [subcats, q]);

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sök på namn eller ID…"
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm w-64"
        />
        <Badge>{loading ? "Laddar…" : `${filtered.length} träffar`}</Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[420px] overflow-auto rounded-xl border border-gray-200 p-2">
        {filtered.map((sc) => (
          <label
            key={sc.id}
            className={classNames(
              "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition",
              selected.includes(sc.id) ? "bg-indigo-50 border-indigo-300" : "bg-white hover:bg-gray-50 border-gray-200"
            )}
          >
            <input
              type="checkbox"
              checked={selected.includes(sc.id)}
              onChange={() => toggle(sc.id)}
              className="accent-indigo-600"
            />
            <span className="text-sm font-medium text-gray-800">{sc.title}</span>
            <span className="ml-auto text-xs text-gray-500">#{sc.id}</span>
          </label>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="text-sm text-gray-500 p-4">Inga subkategorier.</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Kategorier (ref) ------------------------------ */
function WooCategoriesPanel() {
  const [data, setData] = useState<ListResponse<WCCategory> | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  useEffect(() => {
    (async () => {
      try {
        const url = `${API.WC_CATEGORIES}?page=${page}&per_page=${perPage}`;
        const res = await jsonFetch<ListResponse<WCCategory>>(url);
        setData(res);
      } catch {
        setData({ items: [], total: 0, pages: 1, page: 1 });
      }
    })();
  }, [page, perPage]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm">Per sida</label>
        <input
          type="number"
          className="w-24 border border-gray-300 rounded-xl px-3 py-1.5 text-sm"
          value={perPage}
          onChange={(e) => setPerPage(Math.max(10, Number(e.target.value) || 50))}
        />
        <Badge>Totalt: {data?.total ?? "–"}</Badge>
      </div>
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">ID</th>
              <th className="text-left px-3 py-2">Namn</th>
              <th className="text-left px-3 py-2">Parent</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((c) => (
              <tr key={c.id} className="odd:bg-white even:bg-gray-50">
                <td className="px-3 py-2 font-mono">{c.id}</td>
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2">{c.parent || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!data && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="ui-btn px-3 py-2 rounded-xl font-semibold"
            disabled={page <= 1}
          >
            Föregående
          </button>
          <Badge>
            Sida {data.page} / {data.pages}
          </Badge>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            className="ui-btn px-3 py-2 rounded-xl font-semibold"
            disabled={page >= (data.pages || 1)}
          >
            Nästa
          </button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- APP --------------------------------- */
const TABS = [
  { key: "import", label: "Importera Britpart" },
  { key: "excel", label: "Avancerad import" }, // SAS/Blob
  { key: "categories", label: "Woo-kategorier" },
  { key: "logs", label: "Produkter" }, // visar vår ProductsTab under fliken "Produkter"
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function App() {
  const [tab, setTab] = useState<TabKey>("import");
  const [selected, setSelected] = useState<number[]>([]);

  // Import-state + handler
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportRunResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function runImport() {
    if (!selected.length) return;
    setImportError(null);
    setImportResult(null);

    try {
      setImporting(true);
      const res = await jsonFetch<ImportRunResult>(API.IMPORT_RUN, {
        method: "POST",
        body: JSON.stringify({ categoryIds: selected }),
      });
      setImportResult(res);
      // console.debug("Import-resultat:", res);
    } catch (e: any) {
      setImportError(e?.message || String(e));
      // console.error(e);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 ui-header border-b border-gray-800/30">
        <div className="w-full max-w-none px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛠️</span>
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">
              Björklin Motor - Landroverdelar.se
            </h1>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <Badge>Endast “subkategorier” (ID-filter)</Badge>
          </div>
        </div>
      </header>

      <main className="w-full max-w-none px-4 sm:px-6 lg:px-8 py-6">
        {/* Flikar */}
        <nav className="flex flex-wrap gap-3">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={classNames(
                  "ui-btn px-4 py-2 rounded-lg font-semibold",
                  active ? "" : "opacity-80"
                )}
                aria-pressed={active}
                aria-current={active ? "page" : undefined}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {tab === "import" && (
          <Section title="Välj Britpart-subkategorier" subtitle="Filtrering sker på subkategori-ID i backend.">
            <SubcategorySelector selected={selected} onChange={setSelected} />
            <div className="h-4" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Per sida vid hämtning</label>
                <input className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" defaultValue={200} />
                <p className="text-xs text-gray-500 mt-1">Backend bör paginera tills allt är hämtat.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Avrundningsläge</label>
                <select className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" defaultValue="none">
                  <option value="none">Ingen</option>
                  <option value="nearest">Närmaste</option>
                  <option value="up">Uppåt</option>
                  <option value="down">Nedåt</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Avrunda till</label>
                <input className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" type="number" min={1} defaultValue={1} />
                <p className="text-xs text-gray-500 mt-1">Ex: 1 = hela kr, 5 = femkronorssteg.</p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                id="btn-importera"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  runImport();
                }}
                disabled={importing || !selected.length}
              >
                {importing ? "Importerar…" : `Importera ${selected.length} valda`}
              </Button>
              <Badge>ID: {selected.join(", ") || "–"}</Badge>
            </div>

            {importError && (
              <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                Fel: {importError}
              </div>
            )}
            {importResult && (
              <div className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
                Klar • Total: {importResult.total} • Skapade: {importResult.created} • Uppdaterade: {importResult.updated} • Skippade: {importResult.skipped} • Fel: {importResult.errors?.length ?? 0}
              </div>
            )}
          </Section>
        )}

        {tab === "excel" && (
          <Section title="Prisfil via SAS/Blob" subtitle="Stor CSV/Excel → chunkad serverbearbetning.">
            <SASPriceImport />
          </Section>
        )}

        {tab === "categories" && (
          <Section title="WooCommerce-kategorier (referens)">
            <WooCategoriesPanel />
          </Section>
        )}

        {tab === "logs" && (
          <Section title="Produkter (WC)">
            <ProductsTab />
          </Section>
        )}

        <footer className="pt-4 text-center text-xs text-gray-500">
          Björklin Motor AB • Organisationsnr 559210-3724 • Kometvägen 2, 755 94 Uppsala
        </footer>
      </main>
    </div>
  );
}
