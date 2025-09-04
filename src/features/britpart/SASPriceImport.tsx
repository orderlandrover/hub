// src/features/britpart/SASPriceImport.tsx
import { useEffect, useMemo, useState } from "react";

type Subcategory = { id: number; title: string; parentId?: number };
type ImportRunBody = { categoryIds: number[]; publish?: boolean; defaultStock?: number; wooCategoryId?: number };
type ImportRunResult = {
  ok: boolean; total: number; created: number; updated: number; skipped: number;
  errors: Array<{ sku?: string; id?: number; error: string }>; sample: any[]; error?: string;
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(()=>"")}`);
  return (await r.json()) as T;
}

export default function SASPriceImport() {
  const [subs, setSubs] = useState<Subcategory[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Ladda subkategorier
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingList(true);
        const data = await jsonFetch<{ items: Subcategory[] } | Subcategory[]>("/api/britpart-subcategories");
        const items = Array.isArray(data) ? data : data.items;
        if (alive) setSubs(items ?? []);
      } catch (e: any) {
        if (alive) setErrMsg(e?.message || String(e));
      } finally { if (alive) setLoadingList(false); }
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return subs;
    return subs.filter(s => String(s.id).includes(f) || (s.title ?? "").toLowerCase().includes(f));
  }, [subs, filter]);

  const toggle = (id: number) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // *** Testa functions-routingen snabbt ***
  async function testApi() {
    setErrMsg(null);
    try {
      console.debug("[UI] GET /api/import-run");
      const ping = await jsonFetch<{ ok: boolean; name: string }>("/api/import-run");
      alert(`API OK: ${ping.name}`);
    } catch (e: any) {
      setErrMsg(e?.message || String(e));
      alert(`API FEL: ${e?.message || e}`);
    }
  }

  async function runImport() {
    setResult(null);
    setErrMsg(null);
    if (!selected.length) { setErrMsg("Välj minst en subkategori."); return; }

    try {
      setImporting(true);
      const body: ImportRunBody = { categoryIds: selected };
      console.debug("[UI] POST /api/import-run body:", body);
      const res = await jsonFetch<ImportRunResult>("/api/import-run", {
        method: "POST",
        body: JSON.stringify(body),
      });
      console.debug("[UI] /api/import-run result:", res);
      setResult(res);
      alert(`Import klar: skapade ${res.created}, uppdaterade ${res.updated}, fel ${res.errors?.length ?? 0}`);
    } catch (e: any) {
      setErrMsg(e?.message || String(e));
      console.error(e);
      alert(`Import fel: ${e?.message || e}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="w-full max-w-none">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-2xl font-semibold">Välj Britpart-subkategorier</h2>
        <button type="button" onClick={testApi} className="text-xs rounded border px-2 py-1 hover:bg-slate-50">
          Testa API
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          className="border rounded px-3 py-2 w-full sm:w-80"
          placeholder="Sök på namn eller ID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-sm text-slate-600">{filtered.length} träffar</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
        {loadingList ? (
          <div className="col-span-full text-slate-600">Laddar…</div>
        ) : (
          filtered.map(s => {
            const isSel = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className={"flex items-center justify-between rounded border px-3 py-2 text-left " +
                  (isSel ? "bg-indigo-50 border-indigo-400" : "bg-white hover:bg-slate-50")}
              >
                <span className="truncate">{s.title ?? "—"} <span className="text-slate-500">#{s.id}</span></span>
                <input type="checkbox" readOnly checked={isSel} className="pointer-events-none" />
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-3 relative z-0">
  <button
    id="btn-importera"
    type="button"
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      console.debug("[UI] klick på Importera", { selected });
      void runImport();
    }}
    disabled={importing || selected.length === 0}
    aria-busy={importing}
    className={
      "relative z-10 rounded px-4 py-2 text-white " +
      (importing || selected.length === 0
        ? "bg-gray-400 cursor-not-allowed"
        : "bg-amber-600 hover:bg-amber-700")
    }
    title={selected.length === 0 ? "Välj minst en subkategori" : "Starta import"}
  >
    {importing ? "Importerar…" : `Importera ${selected.length} valda`}
  </button>

  {selected.length > 0 && (
    <span className="text-xs text-slate-600">
      ID: {selected.join(", ").slice(0, 120)}
      {selected.join(", ").length > 120 ? "…" : ""}
    </span>
  )}
</div>


      <div className="mt-4 space-y-2">
        {errMsg && <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3">{errMsg}</div>}
        {result && (
          <div className="text-sm bg-green-50 border border-green-200 rounded p-3">
            <div className="font-medium mb-1">Import klar</div>
            <div>Total: {result.total} • Skapade: {result.created} • Uppdaterade: {result.updated} • Skippade: {result.skipped}</div>
            {result.errors?.length ? (
              <details className="mt-2"><summary className="cursor-pointer">Fel ({result.errors.length})</summary>
                <ul className="list-disc ml-6 mt-1">
                  {result.errors.slice(0, 10).map((e, i) => <li key={i}><code>{e.sku ?? "?"}</code>: {e.error}</li>)}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
