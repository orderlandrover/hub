import { useEffect, useRef, useMemo, useState } from "react";
import ProductsTab from "./features/products/ProductsTab";
import { SASPriceImportPanel, QuickImportOne } from "./features/britpart/SASPriceImport";

/* ------------------------------------------------------------------
 *  APP – Britpart/WooCommerce UI (slimmad + extra flikar)
 * ------------------------------------------------------------------ */

/* ------------------------------ Typer ------------------------------ */
export type WCProduct = {
  id: number;
  name: string;
  sku: string;
  status: "publish" | "draft" | "pending" | "private";
  regular_price?: string;
  sale_price?: string | null;
  stock_status?: string;
  stock_quantity?: number | null;
  categories?: { id: number; name?: string }[];
  images?: { src: string }[];
};

export type ListResponse<T> = { items: T[]; total: number; pages: number; page: number };
export type WCCategory = { id: number; name: string; parent: number };
export type Subcategory = { id: number; title: string; parentId?: number };
export type LogEntry = { ts: string; level: "info" | "warn" | "error"; msg: string };
export type RoundModeUI = "nearest" | "up" | "down" | "none";

export type ScheduleConfig = {
  enabled: boolean;
  hour: number;   // 0-23
  minute: number; // 0-59
  subcategoryIds: number[];
};

export type PriceUpdateRow = {
  sku: string;
  regular_price?: number | null;
  sale_price?: number | null;
  stock_quantity?: number | null;
  status?: "publish" | "draft" | "private" | "pending";
};

/* ----------------------------- Konstanter ----------------------------- */
const API = {
  BRITPART_SUBCATS: "/api/britpart-subcategories", // GET -> { items: Subcategory[] }
  IMPORT_PRODUCTS: "/api/britpart-import",         // POST -> { imported, created, updated }
  WC_CATEGORIES: "/api/wc-categories",             // GET -> ListResponse<WCCategory>
  WC_PRODUCTS: "/api/wc-products",                 // GET -> ListResponse<WCProduct>
  UPDATE_PRICES: "/api/wc-products/update-prices", // POST -> { updated, failed, errors? }
  LOGS: "/api/logs",                               // GET -> ListResponse<LogEntry>
  SCHEDULES: "/api/schedules",                     // GET/POST -> ScheduleConfig
} as const;

/* ---------------------------- Hjälpfunktioner ---------------------------- */
async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${text || r.statusText}`);
  }
  return (await r.json()) as T;
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function useDebounced<T>(value: T, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

/* ----------------------------- UI-Komponenter ----------------------------- */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warn" | "error" }) {
  const palette: Record<string, string> = {
    neutral: "bg-gray-100 text-gray-700",
    success: "bg-emerald-100 text-emerald-700",
    warn: "bg-amber-100 text-amber-800",
    error: "bg-rose-100 text-rose-700",
  };
  return <span className={classNames("px-2 py-0.5 rounded text-xs", palette[tone])}>{children}</span>;
}

function Button({ children, onClick, variant = "primary", disabled }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "outline"; disabled?: boolean }) {
  const styles: Record<string, string> = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white",
    ghost: "bg-transparent hover:bg-gray-100 text-gray-800",
    outline: "border border-gray-300 hover:bg-gray-50 text-gray-800",
  };
  return (
    <button disabled={disabled} onClick={onClick} className={classNames("px-3 py-2 rounded-xl text-sm font-medium transition", styles[variant], disabled && "opacity-50 cursor-not-allowed")}>{children}</button>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1 text-xs text-gray-800">
      {label}
      {onRemove && (
        <button onClick={onRemove} className="ml-1 hover:text-rose-600" title="Ta bort">×</button>
      )}
    </span>
  );
}

/* ------------------------ Subkategori Multiselect ------------------------ */
function SubcategorySelector({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [subcats, setSubcats] = useState<Subcategory[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDebounced(query);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await jsonFetch<{ items: Subcategory[] }>(`${API.BRITPART_SUBCATS}`);
        if (!alive) return;
        const sorted = [...res.items].sort((a, b) => a.title.localeCompare(b.title, "sv"));
        setSubcats(sorted);
      } catch (e) {
        console.error(e);
        alert(`Kunde inte hämta Britpart-subkategorier. Kontrollera API: ${API.BRITPART_SUBCATS}`);
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!subcats) return [];
    if (!q) return subcats;
    const s = q.toLowerCase();
    return subcats.filter((x) => x.title.toLowerCase().includes(s) || String(x.id).includes(s));
  }, [subcats, q]);

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const clearAll = () => onChange([]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sök på namn eller ID…" className="border border-gray-300 rounded-xl px-3 py-2 text-sm w-64" />
        <Badge tone="neutral">{loading ? "Laddar…" : `${filtered.length} träffar`}</Badge>
        {!!selected.length && (
          <>
            <Badge tone="success">{selected.length} valda</Badge>
            <Button variant="ghost" onClick={clearAll}>Rensa val</Button>
          </>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[420px] overflow-auto rounded-xl border border-gray-200 p-2">
        {filtered.map((sc) => (
          <label key={sc.id} className={classNames("flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition", selected.includes(sc.id) ? "bg-indigo-50 border-indigo-300" : "bg-white hover:bg-gray-50 border-gray-200")}> 
            <input type="checkbox" checked={selected.includes(sc.id)} onChange={() => toggle(sc.id)} className="accent-indigo-600" />
            <span className="text-sm font-medium text-gray-800">{sc.title}</span>
            <span className="ml-auto text-xs text-gray-500">#{sc.id}</span>
          </label>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="text-sm text-gray-500 p-4">Inga subkategorier matchar din sökning.</div>
        )}
      </div>
      {!!selected.length && (
        <div className="flex flex-wrap gap-2 pt-1">
          {selected.map((id) => (
            <Chip key={id} label={`#${id}`} onRemove={() => toggle(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Import-panelen --------------------------- */
function ImportPanel({ selected, onImported }: { selected: number[]; onImported: (stats: { imported: number; created: number; updated: number }) => void }) {
  const [perPage, setPerPage] = useState(200);
  const [roundMode, setRoundMode] = useState<RoundModeUI>("none");
  const [roundTo, setRoundTo] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  const importNow = async () => {
    if (!selected.length) {
      alert("Välj minst en subkategori först.");
      return;
    }
    try {
      setBusy(true);
      const payload = {
        subcategoryIds: selected,
        options: { perPage, roundMode, roundTo },
      };
      const res = await jsonFetch<{ imported: number; created: number; updated: number }>(API.IMPORT_PRODUCTS, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onImported(res);
    } catch (e) {
      console.error(e);
      alert(`Importen misslyckades: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Per sida vid hämtning</label>
          <input type="number" min={50} max={500} value={perPage} onChange={(e) => setPerPage(Math.max(1, Number(e.target.value) || 200))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
          <p className="text-xs text-gray-500 mt-1">Backend bör paginera tills allt är hämtat.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Avrundningsläge</label>
          <select value={roundMode} onChange={(e) => setRoundMode(e.target.value as RoundModeUI)} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm">
            <option value="none">Ingen</option>
            <option value="nearest">Närmaste</option>
            <option value="up">Uppåt</option>
            <option value="down">Nedåt</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Avrunda till</label>
          <input type="number" min={1} step={1} value={roundTo} onChange={(e) => setRoundTo(Math.max(1, Number(e.target.value) || 1))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
          <p className="text-xs text-gray-500 mt-1">Ex: 1=hela kr, 5=femkronorssteg.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={importNow} disabled={busy}>{busy ? "Importerar…" : `Importera ${selected.length} valda`}</Button>
        <Badge tone="neutral">ID: {selected.join(", ") || "–"}</Badge>
      </div>
    </div>
  );
}

/* ------------------------ Excel/Pris-uppdateringar ------------------------ */
function ExcelPricePanel() {
  const [rows, setRows] = useState<PriceUpdateRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const parseFile = async (file: File) => {
    try {
      setParsing(true);
      // Typad dynamic import med try/catch (undviker TS2347)
      let XLSX: typeof import("xlsx");
      try {
        XLSX = (await import("xlsx")) as typeof import("xlsx");
      } catch {
        alert("Kunde inte ladda 'xlsx'. Installera: npm i xlsx");
        return;
      }

      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const opts: any = { raw: false, defval: "" };
      const json = XLSX.utils.sheet_to_json<any>(ws, opts);
      const out: PriceUpdateRow[] = json
        .map((r: any) => ({
          sku: String(r.sku ?? r.SKU ?? r.Sku ?? r.SkU ?? "").trim(),
          regular_price: r.regular_price !== "" ? Number(r.regular_price) : null,
          sale_price: r.sale_price !== "" ? Number(r.sale_price) : null,
          stock_quantity: r.stock_quantity !== "" ? Number(r.stock_quantity) : null,
          status: r.status || undefined,
        }))
        .filter((x: PriceUpdateRow) => x.sku);
      setRows(out);
    } finally {
      setParsing(false);
    }
  };

  const send = async () => {
    if (!rows.length) { alert("Ladda upp en Excel först."); return; }
    try {
      const res = await jsonFetch<{ updated: number; failed: number; errors?: string[] }>(API.UPDATE_PRICES, {
        method: "POST",
        body: JSON.stringify({ items: rows }),
      });
      alert(`Klart! Uppdaterade: ${res.updated}. Misslyckade: ${res.failed}`);
    } catch (e) {
      console.error(e);
      alert(`Kunde inte skicka prisuppdatering: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} className="block" />
        {parsing && <Badge tone="neutral">Läser Excel…</Badge>}
        {!!rows.length && <Badge tone="success">{rows.length} rader redo</Badge>}
        <Button onClick={send} disabled={!rows.length}>Skicka till WooCommerce</Button>
        <Button variant="ghost" onClick={() => { setRows([]); if (inputRef.current) inputRef.current.value = ""; }}>Rensa</Button>
      </div>

      {!!rows.length && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-right px-3 py-2">Ord. pris</th>
                <th className="text-right px-3 py-2">Kampanjpris</th>
                <th className="text-right px-3 py-2">Lager</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r, i) => (
                <tr key={i} className={i % 2 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-3 py-2 font-mono">{r.sku}</td>
                  <td className="px-3 py-2 text-right">{r.regular_price ?? ""}</td>
                  <td className="px-3 py-2 text-right">{r.sale_price ?? ""}</td>
                  <td className="px-3 py-2 text-right">{r.stock_quantity ?? ""}</td>
                  <td className="px-3 py-2">{r.status ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 300 && (
            <div className="text-xs text-gray-500 p-2">Visar de första 300 raderna av {rows.length}…</div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500">Tips: Kolumnnamn kan vara små/stora bokstäver. Minst SKU krävs.</p>
    </div>
  );
}

/* ------------------------------ Schemaläggning ------------------------------ */
function SchedulePanel({ selected }: { selected: number[] }) {
  const [cfg, setCfg] = useState<ScheduleConfig>({ enabled: false, hour: 2, minute: 15, subcategoryIds: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        let server: ScheduleConfig | null = null;
        try {
          server = await jsonFetch<ScheduleConfig>(API.SCHEDULES);
        } catch {
          server = null;
        }
        if (!alive) return;
        if (server) setCfg(server);
        else {
          const ls = localStorage.getItem("bp_schedule");
          if (ls) setCfg(JSON.parse(ls));
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (selected.length) setCfg((prev) => ({ ...prev, subcategoryIds: selected }));
  }, [selected]);

  const save = async () => {
    try {
      let res: ScheduleConfig | null = null;
      try {
        res = await jsonFetch<ScheduleConfig>(API.SCHEDULES, { method: "POST", body: JSON.stringify(cfg) });
      } catch {
        res = null;
      }
      if (res) {
        setCfg(res);
        alert("Schema sparat på servern.");
      } else {
        localStorage.setItem("bp_schedule", JSON.stringify(cfg));
        alert("Schema sparat lokalt (fallback). Implementera /api/schedules i backend för serverlagring.");
      }
    } catch (e) {
      console.error(e);
      alert(`Kunde inte spara schema: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="accent-indigo-600" />
          <span className="text-sm">Aktivera nattimport</span>
        </label>
        {loading && <Badge tone="neutral">Laddar…</Badge>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Timme</label>
          <input type="number" min={0} max={23} value={cfg.hour} onChange={(e) => setCfg({ ...cfg, hour: clampInt(e.target.value, 0, 23) })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Minut</label>
          <input type="number" min={0} max={59} value={cfg.minute} onChange={(e) => setCfg({ ...cfg, minute: clampInt(e.target.value, 0, 59) })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Subkategorier</label>
          <div className="flex flex-wrap gap-2">
            {(cfg.subcategoryIds || []).map((id) => <Chip key={id} label={`#${id}`} />)}
            {!cfg.subcategoryIds?.length && <span className="text-xs text-gray-500">Inga val ännu – synkas från huvudvyn.</span>}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save}>Spara schema</Button>
        <Badge tone="neutral">Kör ~{cfg.hour.toString().padStart(2, "0")}:{cfg.minute.toString().padStart(2, "0")} dagligen</Badge>
      </div>
    </div>
  );
}

/* ------------------------------- Woo-kategorier ------------------------------- */
function WooCategoriesPanel() {
  const [data, setData] = useState<ListResponse<WCCategory> | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const url = `${API.WC_CATEGORIES}?page=${page}&per_page=${perPage}`;
        const res = await jsonFetch<ListResponse<WCCategory>>(url);
        if (!alive) return;
        setData(res);
      } catch (e) {
        console.error(e);
        alert(`Kunde inte hämta Woo-kategorier. Kontrollera API: ${API.WC_CATEGORIES}`);
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [page, perPage]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm">Per sida</label>
        <input type="number" className="w-24 border border-gray-300 rounded-xl px-3 py-1.5 text-sm" value={perPage} onChange={(e) => setPerPage(Math.max(10, Number(e.target.value) || 50))} />
        <Badge tone="neutral">Totalt: {data?.total ?? "–"}</Badge>
        {loading && <Badge tone="neutral">Laddar…</Badge>}
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
            {data?.items.map((c) => (
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
          <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Föregående</Button>
          <Badge tone="neutral">Sida {data.page} / {data.pages}</Badge>
          <Button variant="outline" onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page >= data.pages}>Nästa</Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Logg-vy -------------------------------- */
function LogsPanel() {
  const [data, setData] = useState<ListResponse<LogEntry> | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        let res: ListResponse<LogEntry> | null = null;
        try {
          res = await jsonFetch<ListResponse<LogEntry>>(`${API.LOGS}?page=1&per_page=200`);
        } catch {
          res = null;
        }
        if (!alive) return;
        setData(res);
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <Button variant="outline" onClick={() => setRefresh((x: number) => x + 1)}>Uppdatera</Button>
        {loading && <Badge tone="neutral">Laddar…</Badge>}
      </div>
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">Tid</th>
              <th className="text-left px-3 py-2">Nivå</th>
              <th className="text-left px-3 py-2">Meddelande</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((l, i) => (
              <tr key={i} className="odd:bg-white even:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{l.ts}</td>
                <td className="px-3 py-2"><Badge tone={l.level === "error" ? "error" : l.level === "warn" ? "warn" : "neutral"}>{l.level}</Badge></td>
                <td className="px-3 py-2">{l.msg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data && <p className="text-sm text-gray-500">Ingen loggdata hittades. Implementera {API.LOGS} i backend.</p>}
    </div>
  );
}

/* --------------------------------- APP --------------------------------- */
const TABS = [
  { key: "import", label: "Importera Britpart" },
  { key: "schedule", label: "Schemalägg nattimport" },
  { key: "excel", label: "Prisuppdatering (Excel)" },
  { key: "categories", label: "Woo-kategorier" },
  { key: "logs", label: "Loggar" },
  { key: "products", label: "Produkter" },       // NYTT
  { key: "advanced", label: "Avancerad import" }, // NYTT
] as const;

type TabKey = typeof TABS[number]["key"];

export default function App() {
  const [tab, setTab] = useState<TabKey>("import");
  const [selected, setSelected] = useState<number[]>([]);
  const [importStats, setImportStats] = useState<{ imported: number; created: number; updated: number } | null>(null);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛠️</span>
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">Landroverdelar – Britpart ↔ WooCommerce</h1>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500">
            <Badge>Endast *subkategorier* (ID-filter)</Badge>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <nav className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={classNames(
                "px-3 py-2 rounded-xl text-sm border transition",
                tab === t.key ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-800 border-gray-200 hover:bg-gray-50"
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "import" && (
          <Section title="Välj Britpart-subkategorier" subtitle="Endast subkategorier exponeras. Filtrering sker på ID i backend.">
            <SubcategorySelector selected={selected} onChange={setSelected} />
            <div className="h-4" />
            <ImportPanel selected={selected} onImported={(s) => setImportStats(s)} />
            {importStats && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="success">Importerade: {importStats.imported}</Badge>
                <Badge tone="neutral">Skapade: {importStats.created}</Badge>
                <Badge tone="neutral">Uppdaterade: {importStats.updated}</Badge>
              </div>
            )}
          </Section>
        )}

        {tab === "schedule" && (
          <Section title="Schemalägg nattimport" subtitle="Välj körningstid och vilka subkategorier som ska importeras nattetid.">
            <SchedulePanel selected={selected} />
          </Section>
        )}

        {tab === "excel" && (
          <Section title="Prisuppdatering via Excel" subtitle="Ladda upp en .xlsx-fil med kolumner: sku, regular_price, sale_price, stock_quantity, status.">
            <ExcelPricePanel />
          </Section>
        )}

        {tab === "categories" && (
          <Section title="WooCommerce-kategorier (publicerade)" subtitle="För referens.">
            <WooCategoriesPanel />
          </Section>
        )}

        {tab === "logs" && (
          <Section title="Loggar" subtitle="Senaste körningar och eventuella felmeddelanden.">
            <LogsPanel />
          </Section>
        )}

        {tab === "products" && (
          <Section title="Produkter" subtitle="Sök, filtrera och massuppdatera produkter.">
            <ProductsTab />
          </Section>
        )}

        {tab === "advanced" && (
          <>
            <Section title="Prisfil via SAS/Blob" subtitle="Chunkad serverbearbetning av stora filer (SKU-matchning → pris/lager).">
              <SASPriceImportPanel />
            </Section>
            <Section title="Snabbimport (1 produkt)" subtitle="Skapar/publicerar en enstaka produkt i WooCommerce.">
              <QuickImportOne />
            </Section>
          </>
        )}

        <footer className="pt-4 text-center text-xs text-gray-500">
          Björklin Motor AB • Organisationsnr 559210-3724 • Kometvägen 2, 755 94 Uppsala
        </footer>
      </main>
    </div>
  );
}

/* --------------------------------- Utils --------------------------------- */
function clampInt(v: string, min: number, max: number) {
  const n = Math.floor(Number(v));
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}
