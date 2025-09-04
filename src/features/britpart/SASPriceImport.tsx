import { useState } from "react";

/** ----------------------------------------------------------------
 *  SASPriceImport: Laddar upp Excel/CSV till Azure Blob via SAS
 *  och kör serverbearbetning i chunkar med /api/price-upload-from-blob
 *  + QuickImportOne: snabbimport av enskild produkt.
 * ---------------------------------------------------------------- */

type RoundModeUI = "nearest" | "up" | "down" | "none";

function parseNum(v: string | number, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const s = v.replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export function SASPriceImportPanel() {
  const [busy, setBusy] = useState(false);
  const [pub, setPub] = useState(true);
  const [dry, setDry] = useState(true);

  const [fx, setFx] = useState<number>(13.5);
  const [markup, setMarkup] = useState<number>(25);
  const [roundMode, setRoundMode] = useState<RoundModeUI>("nearest");
  const [roundStep, setRoundStep] = useState<number>(1);

  const [log, setLog] = useState<string[]>([]);

  // Chunk & batch
  const CHUNK_ROWS = 500;
  const INNER_BATCH = 250;
  const PAUSE_MS = 600;

  function addLog(s: string) {
    const stamp = new Date().toLocaleString();
    setLog((prev) => [`[${stamp}] ${s}`, ...prev].slice(0, 500));
  }

  async function safeJson(res: Response): Promise<any> {
    const t = await res.text();
    try { return JSON.parse(t); } catch { return { ok: false, raw: t, status: res.status }; }
  }

  async function runChunkedPriceImport(file: File) {
    try {
      setBusy(true);
      addLog(`Vald fil: ${file.name}`);

      const fxNum = parseNum(String(fx));
      const markupNum = parseNum(String(markup), 0);
      if (!Number.isFinite(fxNum) || fxNum <= 0) throw new Error("Ogiltig valutakurs");
      if (!Number.isFinite(markupNum) || markupNum < 0) throw new Error("Ogiltigt påslag (%)");

      const roundModeApi =
        roundMode === "nearest" ? "near" :
        roundMode === "up"      ? "up"   :
        roundMode === "down"    ? "down" : "near";
      const stepApi = roundMode === "none" ? 0 : Number(roundStep || 1);

      // 1) SAS
      addLog("Begär SAS-URL…");
      const sasRes = await fetch("/api/price-upload-sas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      const sasJson = await safeJson(sasRes);
      if (!sasRes.ok || !sasJson?.ok) throw new Error(`SAS-fel (${sasRes.status}): ${sasJson?.error || sasJson?.raw || "unknown"}`);
      const { sasUrl, container, blobName } = sasJson as { sasUrl: string; container: string; blobName: string };
      addLog("SAS mottagen.");

      // 2) PUT -> Blob
      addLog("Laddar upp filen till Blob Storage…");
      const headers: Record<string, string> = { "x-ms-blob-type": "BlockBlob" };
      headers["Content-Type"] = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/octet-stream");
      const put = await fetch(sasUrl, { method: "PUT", headers, body: file });
      if (!put.ok) throw new Error(`Blob PUT ${put.status}: ${(await put.text()).slice(0, 300)}`);
      addLog("Uppladdning klar.");

      // 3) Delkörningar
      let offset = 0;
      let part = 1;
      let grand = { updated: 0, skipped: 0, notFound: 0, badRows: 0, total: 0 };

      while (true) {
        addLog(`Startar server-bearbetning (del ${part})… fx=${fxNum}, markup=${markupNum}, step=${stepApi}, round=${roundModeApi}, offset=${offset}, limit=${CHUNK_ROWS}`);

        const body = {
          container, blobName,
          fx: fxNum, markupPct: markupNum,
          roundMode: roundModeApi, step: stepApi,
          publish: !!pub, dryRun: !!dry,
          batchSize: INNER_BATCH,
          offset, limitRows: CHUNK_ROWS,
        };

        const procRes = await fetch("/api/price-upload-from-blob", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = await safeJson(procRes);
        if (!procRes.ok || !out?.ok) {
          throw new Error(
            (out?.error || `Bearbetning misslyckades (${procRes.status})`) +
            (out?.details ? ` ${JSON.stringify(out.details)}` : "") +
            (out?.raw ? ` – ${String(out.raw).slice(0, 200)}` : "")
          );
        }

        grand.updated  += Number(out.updated || 0);
        grand.skipped  += Number(out.skipped || 0);
        grand.notFound += Number(out.notFound || 0);
        grand.badRows  += Number(out.badRows || 0);
        grand.total     = Number(out.total || grand.total);

        addLog(`Del ${part} klar: rader ${out.range?.offset}–${(out.range?.end ?? 0) - 1}, updated=${out.updated}, skipped=${out.skipped}, notFound=${out.notFound}, bad=${out.badRows}`);

        const next = out.nextOffset as number | null;
        if (!next || next >= out.total) break;
        offset = next;
        part++;

        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }

      addLog(`KLART: total=${grand.total}, updated=${grand.updated}, skipped=${grand.skipped}, notFound=${grand.notFound}, bad=${grand.badRows}`);
    } catch (e: any) {
      addLog(`Fel: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border p-5">
      <h2 className="text-lg font-semibold mb-1">Prisfil (SAS/Blob) → WooCommerce</h2>
      <p className="text-sm opacity-70 mb-3">Kör chunkad serverbearbetning. Matchar på SKU och uppdaterar pris/lager enligt dina inställningar.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div>
          <label className="text-xs opacity-70">Valutakurs (GBP→SEK)</label>
          <input type="text" inputMode="decimal" className="w-full rounded-lg border px-3 py-2" value={String(fx)} onChange={(e) => setFx(parseNum(e.target.value, fx))} />
        </div>
        <div>
          <label className="text-xs opacity-70">Påslag (%)</label>
          <input type="text" inputMode="decimal" className="w-full rounded-lg border px-3 py-2" value={String(markup)} onChange={(e) => setMarkup(parseNum(e.target.value, markup))} />
        </div>
        <div>
          <label className="text-xs opacity-70">Avrundning</label>
          <select className="w-full rounded-lg border px-3 py-2" value={roundMode} onChange={(e) => setRoundMode(e.target.value as RoundModeUI)}>
            <option value="nearest">Närmaste</option><option value="up">Uppåt</option><option value="down">Nedåt</option><option value="none">Ingen</option>
          </select>
        </div>
        <div>
          <label className="text-xs opacity-70">Steg (SEK)</label>
          <select className="w-full rounded-lg border px-3 py-2" value={roundStep} onChange={(e) => setRoundStep(Number(e.target.value))}>
            <option value={1}>1</option><option value={5}>5</option><option value={10}>10</option>
          </select>
        </div>
      </div>

      <label className="block rounded-lg border px-4 py-6 text-center cursor-pointer bg-white hover:bg-slate-50 font-semibold">
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && runChunkedPriceImport(e.target.files[0])} />
        {busy ? "Bearbetar…" : "Välj fil…"}
      </label>

      <div className="mt-3 flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-amber-600" checked={pub} onChange={() => setPub(!pub)} />
          Publicera direkt (annars draft)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-amber-600" checked={dry} onChange={() => setDry(!dry)} />
          Dry-run (visa bara vad som skulle ändras)
        </label>
        <span className="ml-auto text-xs opacity-60">Kör 500 rader/körning</span>
      </div>

      <div className="mt-4 h-56 overflow-auto rounded-lg border bg-slate-50 p-3 text-sm font-mono leading-relaxed">
        {log.length === 0 ? <div className="text-slate-400">Inga händelser ännu.</div> : <ul className="space-y-1">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </div>
    </section>
  );
}

export function QuickImportOne() {
  const [busy, setBusy] = useState(false);
  const [sku, setSku] = useState("");
  const [pname, setPname] = useState("");
  const [pprice, setPprice] = useState("");
  const [pstock, setPstock] = useState<number | "">("");
  const [pcat, setPcat] = useState<number | "">("");
  const [pstatus, setPstatus] = useState<"publish" | "draft">("publish");
  const [pimg, setPimg] = useState("");

  async function handleImportOne() {
    try {
      setBusy(true);
      const res = await fetch("/api/import-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          name: pname || undefined,
          price: pprice || undefined,
          stock: pstock === "" ? undefined : Number(pstock),
          categoryId: pcat === "" ? undefined : Number(pcat),
          status: pstatus,
          image: pimg || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Fel vid import");
      alert(`OK: #${j.id} (${j.status})`);
    } catch (e: any) {
      alert(`Fel: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border p-5">
      <h2 className="text-lg font-semibold mb-1">Britpart snabbimport (1 produkt)</h2>
      <div className="grid grid-cols-2 gap-2">
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU (obligatorisk)" className="rounded-lg border px-3 py-2 col-span-2" />
        <input value={pname} onChange={(e) => setPname(e.target.value)} placeholder="Namn" className="rounded-lg border px-3 py-2 col-span-2" />
        <input value={pprice} onChange={(e) => setPprice(e.target.value)} placeholder="Pris (SEK)" className="rounded-lg border px-3 py-2" />
        <input value={pstock as any} onChange={(e) => setPstock(e.target.value ? Number(e.target.value) : "")} placeholder="Lager" className="rounded-lg border px-3 py-2" />
        <input value={pcat as any} onChange={(e) => setPcat(e.target.value ? Number(e.target.value) : "")} placeholder="Kategori ID" className="rounded-lg border px-3 py-2" />
        <select value={pstatus} onChange={(e) => setPstatus(e.target.value as any)} className="rounded-lg border px-3 py-2">
          <option value="publish">Publicera</option>
          <option value="draft">Utkast</option>
        </select>
        <input value={pimg} onChange={(e) => setPimg(e.target.value)} placeholder="Bild-URL (valfritt)" className="rounded-lg border px-3 py-2 col-span-2" />
      </div>
      <button disabled={!sku || busy} onClick={handleImportOne} className="mt-3 px-4 py-2 rounded-lg border bg-white hover:bg-slate-50 font-semibold disabled:opacity-50">
        Importera nu
      </button>
    </section>
  );
}
