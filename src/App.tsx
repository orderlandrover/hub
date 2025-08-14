import { useMemo, useState } from "react";

// --- Starter UI for Landroverdelar.se Britpart ↔ WooCommerce integration
// Tailwind-first, no external UI kit required.
// Wire the handlers to your APIs (Azure Functions or backend) noted in comments below.

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [wcUrl, setWcUrl] = useState("");
  const [wcKey, setWcKey] = useState("");
  const [wcSecret, setWcSecret] = useState("");

  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scheduleNightly, setScheduleNightly] = useState(true);
  const [logLines, setLogLines] = useState<string[]>([]);

  const selectedCount = selectedIds.length;

  function log(line: string) {
    const stamp = new Date().toLocaleString();
    setLogLines((prev) => [
      `[${stamp}] ${line}`,
      ...prev,
    ].slice(0, 400));
  }

  async function handleFetchCategories() {
    try {
      log("Fetching Britpart subcategories…");
      // TODO: Replace with your API endpoint hosted in Azure Functions
      // e.g., const res = await fetch(`/api/britpart/subcategories`, { headers: { Authorization: `Bearer ${apiKey}` } });
      // const data = await res.json();
      // setCategories(data.items);

      // Mock data for local prototyping
      const mock = Array.from({ length: 25 }).map((_, i) => ({ id: String(1000 + i), name: `Subcategory #${i + 1}` }));
      await new Promise((r) => setTimeout(r, 600));
      setCategories(mock);
      log(`Loaded ${mock.length} subcategories.`);
    } catch (err) {
      console.error(err);
      log("Failed to fetch categories.");
    }
  }

  function toggleId(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleImport() {
    if (!selectedIds.length) {
      log("Select at least one subcategory to import.");
      return;
    }
    setImporting(true);
    try {
      log(`Importing ${selectedIds.length} subcategory(s) → WooCommerce…`);
      // TODO: POST to your function: /api/import/subcategories { britpartKey, wcCreds, subcategoryIds }
      await new Promise((r) => setTimeout(r, 1200));
      log("Import finished ✅");
    } catch (err) {
      console.error(err);
      log("Import failed ❌");
    } finally {
      setImporting(false);
    }
  }

  async function handleExcelUpload(file: File) {
    setUploading(true);
    try {
      log(`Uploading Excel: ${file.name}`);
      // TODO: send to /api/import/excel (server parses via SheetJS, updates prices/stock)
      await new Promise((r) => setTimeout(r, 800));
      log("Excel processed. Price updates queued ✅");
    } catch (e) {
      console.error(e);
      log("Excel import failed ❌");
    } finally {
      setUploading(false);
    }
  }

  const canImport = useMemo(() => apiKey && wcUrl && wcKey && wcSecret && selectedIds.length > 0, [apiKey, wcUrl, wcKey, wcSecret, selectedIds.length]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Britpart Integration Dashboard</h1>
          <div className="text-sm text-slate-500">Björklin Motor AB • landroverdelar.se</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Credentials */}
        <section className="bg-white rounded-2xl shadow p-5 grid md:grid-cols-2 gap-4">
          <div>
            <h2 className="font-semibold mb-2">Britpart API</h2>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key"
              className="w-full rounded-xl border px-3 py-2"
              type="password"
              autoComplete="off"
            />
            <p className="text-xs text-slate-500 mt-2">Stored server-side via Azure Functions & app settings. Never expose in client bundle.</p>
          </div>
          <div>
            <h2 className="font-semibold mb-2">WooCommerce REST</h2>
            <div className="grid grid-cols-1 gap-2">
              <input value={wcUrl} onChange={(e) => setWcUrl(e.target.value)} placeholder="https://landroverdelar.se" className="w-full rounded-xl border px-3 py-2" />
              <input value={wcKey} onChange={(e) => setWcKey(e.target.value)} placeholder="Consumer Key" className="w-full rounded-xl border px-3 py-2" type="password" />
              <input value={wcSecret} onChange={(e) => setWcSecret(e.target.value)} placeholder="Consumer Secret" className="w-full rounded-xl border px-3 py-2" type="password" />
            </div>
          </div>
        </section>

        {/* Category selection */}
        <section className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Välj Britpart underkategorier</h2>
            <div className="flex items-center gap-2">
              <button onClick={handleFetchCategories} className="rounded-xl border px-3 py-1.5 hover:bg-slate-50">Hämta kategorier</button>
              <span className="text-sm text-slate-500">Valda: {selectedCount}</span>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {categories.map((c) => (
              <label key={c.id} className={`group cursor-pointer rounded-xl border p-3 flex items-center gap-3 ${selectedIds.includes(c.id) ? "bg-indigo-50 border-indigo-300" : "hover:bg-slate-50"}`}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(c.id)}
                  onChange={() => toggleId(c.id)}
                  className="accent-indigo-600"
                />
                <span className="truncate">{c.name}</span>
                <span className="ml-auto text-xs text-slate-400">#{c.id}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Actions */}
        <section className="bg-white rounded-2xl shadow p-5 grid md:grid-cols-3 gap-4">
          <div>
            <h3 className="font-semibold mb-2">Importera produkter</h3>
            <button
              disabled={!canImport || importing}
              onClick={handleImport}
              className={`w-full rounded-xl px-4 py-2 text-white ${!canImport || importing ? "bg-indigo-300" : "bg-indigo-600 hover:bg-indigo-700"}`}
            >
              {importing ? "Importerar…" : "Starta import"}
            </button>
            <p className="text-xs text-slate-500 mt-2">Importerar endast valda underkategorier. Skapar/uppdaterar produkter och kopplar mot rätt WooCommerce-kategorier.</p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Excel-prisuppdatering</h3>
            <label className="block rounded-xl border px-4 py-6 text-center cursor-pointer hover:bg-slate-50">
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => e.target.files && e.target.files[0] && handleExcelUpload(e.target.files[0])}
              />
              {uploading ? "Laddar upp…" : "Ladda upp Excel"}
            </label>
            <p className="text-xs text-slate-500 mt-2">Excel-format enligt mall: SKU, Pris, Lager, Status.</p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Schemaläggning</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={scheduleNightly} onChange={() => setScheduleNightly(!scheduleNightly)} className="accent-indigo-600" />
              Kör nattlig import (nya produkter)
            </label>
            <button
              onClick={() => log(scheduleNightly ? "Nightly import enabled (mock)" : "Nightly import disabled (mock)")}
              className="mt-2 w-full rounded-xl border px-4 py-2 hover:bg-slate-50"
            >
              Spara schema
            </button>
            <p className="text-xs text-slate-500 mt-2">Använd Azure Functions Timer Trigger eller GitHub Actions cron för verklig schemaläggning.</p>
          </div>
        </section>

        {/* Logs */}
        <section className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Logg</h3>
            <button onClick={() => setLogLines([])} className="rounded-xl border px-3 py-1.5 hover:bg-slate-50">Rensa</button>
          </div>
          <div className="h-56 overflow-auto rounded-xl border bg-slate-50 p-3 text-sm font-mono leading-relaxed">
            {logLines.length === 0 ? (
              <div className="text-slate-400">Inga händelser ännu.</div>
            ) : (
              <ul className="space-y-1">
                {logLines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-10 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Björklin Motor AB — Prototype UI (SWA)
      </footer>
    </div>
  );
}
