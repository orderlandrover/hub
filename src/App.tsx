import React, { useEffect, useMemo, useState } from "react";
import SASPriceImport from "./features/britpart/SASPriceImport";
import ProductsTab from "./features/products/ProductsTab";
import { runImport } from "./api/britpart";

/* ----------------------------- Typer ----------------------------- */
type Subcategory = { id: number; title: string; parentId?: number };
type ListResponse<T> = { items: T[]; total: number; pages: number; page: number };
type WCCategory = { id: number; name: string; parent: number };
type RoundModeUI = "none" | "nearest" | "up" | "down";

/** Probe-typer (från /api/britpart-probe-categories) */
type ProbeLeaf = { leafId: number; count: number; sampleSkus: string[] };
type ProbeResponse = {
  ok: boolean;
  inputIds: number[];
  uniqueSkuCount: number;
  leaves: ProbeLeaf[];
  sampleAll: string[];
};

/* -------------------------- Login-gate -------------------------- */
function LoginGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<"checking" | "need-login" | "ok">("checking");
  const [u, setU] = React.useState("");
  const [p, setP] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth-me", { credentials: "include" });
        setState(r.ok ? "ok" : "need-login");
      } catch {
        setState("need-login");
      }
    })();
  }, []);

  const doLogin = async () => {
    try {
      setBusy(true);
      setErr(null);
      const r = await fetch("/api/auth-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: u, password: p }),
      });
      if (!r.ok) throw new Error(await r.text().catch(() => "Login failed"));
      setState("ok");
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking") {
    return (
      <div className="min-h-screen grid place-items-center text-gray-600">
        <div>Laddar…</div>
      </div>
    );
  }
  if (state === "need-login") {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50">
        <div className="bg-white border rounded-2xl p-6 shadow w-[360px]">
          <h1 className="text-lg font-semibold mb-4">Logga in</h1>
          <div className="space-y-3">
            <input
              className="w-full border rounded-xl px-3 py-2 text-sm"
              placeholder="Användarnamn"
              value={u}
              onChange={(e) => setU(e.target.value)}
            />
            <input
              className="w-full border rounded-xl px-3 py-2 text-sm"
              placeholder="Lösenord"
              type="password"
              value={p}
              onChange={(e) => setP(e.target.value)}
            />
            {err && <div className="text-sm text-red-600">{err}</div>}
            <button
              onClick={doLogin}
              disabled={busy}
              className="w-full px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Loggar in…" : "Logga in"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/* --------------------------- Utils / API --------------------------- */
const API = {
  BRITPART_SUBCATS: "/api/britpart-subcategories",
  WC_CATEGORIES: "/api/wc-categories",
  BRITPART_PROBE_CATS: "/api/britpart-probe-categories",
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => "")}`);
  return (await r.json()) as T;
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

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
      className={classNames(
        "px-3 py-2 rounded-xl text-sm font-medium transition",
        styles[variant],
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </button>
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
        if (!alive) return;

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
        setSubcats(sorted);
      } catch {
        setSubcats([]);
      } finally {
        setLoading(false);
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
              selected.includes(sc.id)
                ? "bg-indigo-50 border-indigo-300"
                : "bg-white hover:bg-gray-50 border-gray-200"
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

/* ------------------------------ Kategorier (ref + synk) ------------------------------ */
function WooCategoriesPanel() {
  const [data, setData] = useState<ListResponse<WCCategory> | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncLog, setSyncLog] = useState<any | null>(null);
  const [roots, setRoots] = useState<string>("91,72"); // ändra som du vill

  async function syncCats(apply: boolean) {
    try {
      setSyncBusy(true);
      setSyncLog(null);

      const ids = roots
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);

      const r = await fetch("/api/sync-britpart-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roots: ids, apply }),
      });

      const txt = await r.text();
      let json: any = {};
      try { json = txt ? JSON.parse(txt) : {}; } catch { json = {}; }

      if (!r.ok) {
        const msg = json?.error || `HTTP ${r.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`;
        throw new Error(msg);
      }
      setSyncLog(json);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setSyncBusy(false);
    }
  }

  async function loadCats(p: number, pp: number) {
    try {
      const url = `${API.WC_CATEGORIES}?page=${p}&per_page=${pp}`;
      const res = await jsonFetch<ListResponse<WCCategory>>(url);
      setData(res);
    } catch {
      setData({ items: [], total: 0, pages: 1, page: 1 });
    }
  }

  useEffect(() => { loadCats(page, perPage); }, [page, perPage]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Britpart-rötter (kommaseparerat)</label>
          <input
            value={roots}
            onChange={(e) => setRoots(e.target.value)}
            className="w-64 border border-gray-300 rounded-xl px-3 py-1.5 text-sm"
            placeholder="t.ex. 91,72"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={syncBusy} onClick={() => syncCats(false)}>
            {syncBusy ? "Kör…" : "Torrkör synk"}
          </Button>
          <Button disabled={syncBusy} onClick={() => syncCats(true)}>
            {syncBusy ? "Kör…" : "Verkställ synk"}
          </Button>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <label className="text-sm">Per sida</label>
          <input
            type="number"
            className="w-24 border border-gray-300 rounded-xl px-3 py-1.5 text-sm"
            value={perPage}
            onChange={(e) => setPerPage(Math.max(5, Number(e.target.value) || 25))}
          />
          <Badge>Totalt: {data?.total ?? "–"}</Badge>
        </div>
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
          <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Föregående
          </Button>
          <Badge>Sida {data.page} / {data.pages}</Badge>
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page >= (data.pages || 1)}
          >
            Nästa
          </Button>
        </div>
      )}

      {syncLog && (
        <div className="p-3 bg-gray-50 rounded-xl border text-xs font-mono max-h-64 overflow-auto">
          <div>verkställd: {String(syncLog.applied)}</div>
          <div>ändringar: {JSON.stringify(syncLog.counts)}</div>
          <div className="mt-2">plan (förkortad):</div>
          {Array.isArray(syncLog.plan) && syncLog.plan.slice(0, 200).map((p: any, i: number) => (
            <div key={i}>
              {p.action}  bp:{p.bpId}  name:{p.name}  parentWc:{p.parentWcId ?? 0}  wc:{p.wcId ?? "-"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- APP --------------------------------- */
const TABS = [
  { key: "import", label: "Importera Britpart" },
  { key: "excel", label: "Avancerad import" },
  { key: "categories", label: "Woo-kategorier" },
  { key: "logs", label: "Produkter" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function App() {
  const [tab, setTab] = useState<TabKey>("import");
  const [selected, setSelected] = useState<number[]>([]);

  // formulär-state
  const [perPage, setPerPage] = useState<number>(25);
  const [roundingMode, setRoundingMode] = useState<RoundModeUI>("none");
  const [roundTo, setRoundTo] = useState<number>(1);

  // import-runner state
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [logLines, setLogLines] = useState<string[]>([]);
  const appendLog = (s: string) => setLogLines((xs) => [...xs.slice(-200), s]);

  // PROBE state
  const [probeLoading, setProbeLoading] = useState(false);
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [selectedLeafs, setSelectedLeafs] = useState<number[]>([]);

  const toggleLeaf = (id: number) =>
    setSelectedLeafs((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const allLeafCount = probe?.leaves?.length ?? 0;
  const selectAllLeafs = () => setSelectedLeafs(probe?.leaves?.map((l) => l.leafId) ?? []);
  const clearLeafs = () => setSelectedLeafs([]);

  const handleProbe = async () => {
    if (!selected.length) return alert("Välj minst en (sub)kategori först.");
    try {
      setProbeLoading(true);
      const res = await jsonFetch<ProbeResponse>(API.BRITPART_PROBE_CATS, {
        method: "POST",
        body: JSON.stringify({ ids: selected }),
      });

      const leaves = Array.isArray(res?.leaves) ? [...res.leaves].sort((a, b) => b.count - a.count) : [];
      setProbe({
        ok: !!res?.ok,
        inputIds: Array.isArray(res?.inputIds) ? res.inputIds : [],
        uniqueSkuCount: Number((res as any)?.uniqueSkuCount ?? 0),
        leaves,
        sampleAll: Array.isArray(res?.sampleAll) ? res.sampleAll : [],
      });
      setSelectedLeafs(leaves.map((x) => x.leafId)); // förvalt: alla
      setLogLines([]);
    } catch (e: any) {
      console.error("Probe fail", e);
      alert(e?.message || String(e));
    } finally {
      setProbeLoading(false);
    }
  };

  // loopar tills backend säger att inget återstår
  const runAllChunks = async () => {
    const ids = selected;
    if (!ids.length) return;

    setIsImporting(true);
    setLogLines([]);
    setProgress({ done: 0, total: 0 });

    try {
      let hasMore = true;
      let totalSkus = 0;
      let remaining = 0;
      let chunk = 0;

      while (hasMore) {
        chunk++;
        appendLog(`Kör chunk ${chunk}…`);

        const r: any = await runImport({
          ids,
          leafIds: selectedLeafs.length ? selectedLeafs : undefined,
          pageSize: Number(perPage) || 25,
          roundingMode,
          roundTo: Number(roundTo) || 1,
        });

        const processed = Number(r?.processedSkus || 0);
        totalSkus = Number(r?.totalSkus || totalSkus);
        remaining = Number(r?.remainingSkus || 0);
        hasMore = !!r?.hasMore;

        const created = Number(r?.created || 0);
        const updated = Number(r?.updatedWithMeta || 0);
        const exists = Number(r?.exists || 0);

        appendLog(
          `✔ chunk ${chunk}: processed=${processed}, created=${created}, updated=${updated}, exists=${exists}, remaining=${remaining}`
        );

        const done = Math.max(0, totalSkus - remaining);
        setProgress({ done, total: totalSkus });

        if (!processed && !hasMore) break;
      }

      alert(
        `Import klar.
Bearbetat i denna session: ~${Math.max(0, progress.done)} (totalt: ${progress.total || "okänt"})
Nyskapade: se loggen
Uppdaterade: se loggen
Återstår nu: ${remaining}`
      );
    } catch (e: any) {
      console.error("Import fail", e);
      appendLog(`✖ Fel: ${e?.message || String(e)}`);
      alert(e?.message || String(e));
    } finally {
      setIsImporting(false);
    }
  };

  const appUi = (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b border-gray-200">
        <div className="w-full px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛠️</span>
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">Landroverdelar</h1>
          </div>
          <button
            className="text-sm text-gray-600 hover:text-gray-900"
            onClick={async () => {
              await fetch("/api/auth-logout", { method: "POST", credentials: "include" });
              location.reload();
            }}
          >
            Logga ut
          </button>
        </div>
      </header>

      <main className="w-full px-6 py-6 space-y-6">
        <nav className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={classNames(
                "px-3 py-2 rounded-xl text-sm border transition",
                tab === t.key
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-900 border-gray-200 hover:bg-gray-50"
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "import" && (
          <Section
            title="Välj Britpart-subkategorier"
            subtitle="Använd 'Förhandsvisa' för att få leaf-ID och antal, välj sedan precis vilka leafs som ska importeras."
          >
            <SubcategorySelector selected={selected} onChange={setSelected} />
            <div className="h-4" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Per sida vid hämtning</label>
                <input
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  type="number"
                  min={10}
                  value={perPage}
                  onChange={(e) => setPerPage(Math.max(10, Number(e.target.value) || 25))}
                />
                <p className="text-xs text-gray-500 mt-1">Backend paginerar tills allt är klart.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Avrundningsläge</label>
                <select
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  value={roundingMode}
                  onChange={(e) => setRoundingMode(e.target.value as RoundModeUI)}
                >
                  <option value="none">Ingen</option>
                  <option value="nearest">Närmaste</option>
                  <option value="up">Uppåt</option>
                  <option value="down">Nedåt</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Avrunda till</label>
                <input
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  type="number"
                  min={1}
                  value={roundTo}
                  onChange={(e) => setRoundTo(Math.max(1, Number(e.target.value) || 1))}
                />
                <p className="text-xs text-gray-500 mt-1">Ex: 1 = hela kr, 5 = femkronorssteg.</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={handleProbe} disabled={!selected.length || probeLoading || isImporting}>
                {probeLoading ? "Läser…" : "Förhandsvisa (probe)"}
              </Button>
              <Button onClick={runAllChunks} disabled={!selected.length || isImporting || !probe}>
                {isImporting ? "Importerar…" : `Importera ${selected.length} valda`}
              </Button>
              <Badge>ID: {selected.join(", ") || "–"}</Badge>
              {isImporting && (
                <div className="flex items-center gap-2 ml-2">
                  <div className="w-48 h-2 bg-gray-200 rounded">
                    <div
                      className="h-2 bg-indigo-600 rounded transition-all"
                      style={{
                        width:
                          progress.total > 0
                            ? `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`
                            : "10%",
                      }}
                    />
                  </div>
                  <span className="text-xs text-gray-600">
                    {progress.total > 0 ? `${progress.done}/${progress.total}` : "pågår…"}
                  </span>
                </div>
              )}
            </div>

            {probe && (
              <div className="mt-4 rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <Badge>Unika SKU totalt (alla leafs): {probe.uniqueSkuCount}</Badge>
                  <Badge>Valda rötter: {probe.inputIds.join(", ")}</Badge>
                  <Badge>Valda leafs: {selectedLeafs.length}/{allLeafCount}</Badge>
                  <Button variant="ghost" onClick={selectAllLeafs} disabled={isImporting}>Välj alla</Button>
                  <Button variant="ghost" onClick={clearLeafs} disabled={isImporting}>Rensa</Button>
                </div>

                <div className="overflow-auto border border-gray-200 rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2">Välj</th>
                        <th className="text-left px-3 py-2">Leaf ID</th>
                        <th className="text-left px-3 py-2">Antal SKU</th>
                        <th className="text-left px-3 py-2">Exempel (max 5)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(probe.leaves || []).map((row) => {
                        const checked = selectedLeafs.includes(row.leafId);
                        return (
                          <tr key={row.leafId} className="odd:bg-white even:bg-gray-50">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="accent-indigo-600"
                                checked={checked}
                                onChange={() => toggleLeaf(row.leafId)}
                                disabled={isImporting}
                              />
                            </td>
                            <td className="px-3 py-2 font-mono">#{row.leafId}</td>
                            <td className="px-3 py-2">{row.count}</td>
                            <td className="px-3 py-2">
                              {Array.isArray(row.sampleSkus) && row.sampleSkus.length ? row.sampleSkus.join(", ") : "–"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {logLines.length > 0 && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg border text-xs font-mono max-h-48 overflow-auto">
                    {logLines.map((l, i) => (<div key={i}>{l}</div>))}
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-2">
                  Tip: Markera enstaka leafs om du vill dela upp stora kategorier i mindre körningar.
                </p>
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

  // Viktigt: hela appen skyddas bakom inloggning
  return <LoginGate>{appUi}</LoginGate>;
}
