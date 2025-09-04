// src/features/britpart/SASPriceImport.tsx
import { useEffect, useMemo, useState } from "react";


type Subcategory = { id: number; title: string; parentId?: number };

type ImportRunBody = {
  categoryIds: number[];
  publish?: boolean;
  defaultStock?: number;
  wooCategoryId?: number;
};

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

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return (await r.json()) as T;
}

export default function SASPriceImport() {
  const [loadingList, setLoadingList] = useState(false);
  const [subs, setSubs] = useState<Subcategory[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [perPage, setPerPage] = useState<number>(200);
  const [roundMode, setRoundMode] = useState<"none" | "nearest" | "up" | "down">("none");
  const [roundTo, setRoundTo] = useState<number>(1);
  const [wooCategoryId, setWooCategoryId] = useState<number | undefined>(undefined);

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Ladda subkategorier
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingList(true);
        // Backend-endpoint som redan finns i ditt API
        const data = await jsonFetch<{ items: Subcategory[] } | Subcategory[]>(
          "/api/britpart-subcategories"
        );
        const items = Array.isArray(data) ? data : data.items;
        if (!alive) return;
        setSubs(items ?? []);
      } catch (e: any) {
        if (!alive) return;
        setErrMsg(e?.message || String(e));
      } finally {
        if (alive) setLoadingList(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return subs;
    return subs.filter(
      (s) =>
        String(s.id).includes(f) ||
        (s.title ?? "").toLowerCase().includes(f)
    );
  }, [subs, filter]);

  const toggle = (id: number) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  async function runImport() {
    setErrMsg(null);
    setResult(null);

    if (selected.length === 0) {
      setErrMsg("Välj minst en subkategori först.");
      return;
    }

    try {
      setImporting(true);

      // OBS: perPage/avrundning används ev. i senare version — här visar vi hur du kan skicka extra options om du vill.
      const body: ImportRunBody = {
        categoryIds: selected,
        // publish: false,
        // defaultStock: 100,
        // wooCategoryId,
      };

      const res = await jsonFetch<ImportRunResult>("/api/import-run", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setResult(res);
    } catch (e: any) {
      setErrMsg(e?.message || String(e));
    } finally {
      setImporting(false);
    }
  }

  const allSelected = selected.length;
  return (
    <div className="w-full max-w-none">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-2xl font-semibold">Filtrering sker på subkategori-ID i backend.</h2>
      </div>

      {/* Sök & antal */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          className="border rounded px-3 py-2 w-full sm:w-80"
          placeholder="Sök på namn eller ID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-sm text-slate-600">{filtered.length} träffar</span>
      </div>

      {/* Lista */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-6">
        {loadingList ? (
          <div className="col-span-full text-slate-600">Laddar subkategorier…</div>
        ) : (
          filtered.map((s) => {
            const isSel = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className={
                  "flex items-center justify-between rounded border px-3 py-2 text-left " +
                  (isSel ? "bg-indigo-50 border-indigo-400" : "bg-white hover:bg-slate-50")
                }
              >
                <span className="truncate">
                  {s.title ?? "—"} <span className="text-slate-500">#{s.id}</span>
                </span>
                <input type="checkbox" readOnly checked={isSel} className="pointer-events-none" />
              </button>
            );
          })
        )}
      </div>

      {/* Inställningar (placeholder, som i din UI) */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-sm">
          Per sida vid hämtning
          <input
            type="number"
            className="border rounded px-2 py-1 ml-2 w-24"
            value={perPage}
            onChange={(e) => setPerPage(Number(e.target.value) || 0)}
          />
        </label>

        <label className="text-sm">
          Avrundningsläge
          <select
            className="border rounded px-2 py-1 ml-2"
            value={roundMode}
            onChange={(e) => setRoundMode(e.target.value as any)}
          >
            <option value="none">Ingen</option>
            <option value="nearest">Nearest</option>
            <option value="up">Up</option>
            <option value="down">Down</option>
          </select>
        </label>

        <label className="text-sm">
          Avrunda till
          <input
            type="number"
            className="border rounded px-2 py-1 ml-2 w-20"
            value={roundTo}
            onChange={(e) => setRoundTo(Number(e.target.value) || 1)}
          />
        </label>

        <label className="text-sm">
          Woo kategori-ID
          <input
            type="number"
            className="border rounded px-2 py-1 ml-2 w-24"
            value={wooCategoryId ?? ""}
            onChange={(e) =>
              setWooCategoryId(e.target.value === "" ? undefined : Number(e.target.value))
            }
            placeholder="valfritt"
          />
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runImport}
          disabled={importing || selected.length === 0}
          className={
            "rounded px-4 py-2 text-white " +
            (importing || selected.length === 0
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-amber-600 hover:bg-amber-700")
          }
          title={selected.length === 0 ? "Välj minst en subkategori" : "Starta import"}
        >
          {importing ? "Importerar…" : `Importera ${allSelected} valda`}
        </button>

        {selected.length > 0 && (
          <span className="text-xs text-slate-600">
            ID: {selected.join(", ").slice(0, 120)}
            {selected.join(", ").length > 120 ? "…" : ""}
          </span>
        )}
      </div>

      {/* Feedback */}
      <div className="mt-4 space-y-2">
        {errMsg && (
          <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3">{errMsg}</div>
        )}
        {result && (
          <div className="text-sm bg-green-50 border border-green-200 rounded p-3">
            <div className="font-medium mb-1">Import klar</div>
            <div>Total: {result.total} • Skapade: {result.created} • Uppdaterade: {result.updated} • Skippade: {result.skipped}</div>
            {result.errors?.length ? (
              <details className="mt-2">
                <summary className="cursor-pointer">Fel ({result.errors.length})</summary>
                <ul className="list-disc ml-6 mt-1">
                  {result.errors.slice(0, 10).map((e, i) => (
                    <li key={i}><code>{e.sku ?? "?"}</code>: {e.error}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
