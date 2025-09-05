import { useRef, useState } from "react";

type RoundModeUI = "nearest" | "up" | "down" | "none";

async function safeJson(res: Response): Promise<any> {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { ok: false, raw: t, status: res.status }; }
}

export default function SASPriceImport() {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [pub, setPub] = useState(true);
  const [dry, setDry] = useState(true);

  const [fx, setFx] = useState<number>(13.5);
  const [markup, setMarkup] = useState<number>(25);
  const [roundMode, setRoundMode] = useState<RoundModeUI>("nearest");
  const [roundStep, setRoundStep] = useState<number>(1);
  const [delimiter, setDelimiter] = useState<"," | ";" | "\t">(",");

  const fileRef = useRef<HTMLInputElement | null>(null);

  const CHUNK_ROWS = 500;
  const INNER_BATCH = 250;
  const PAUSE_MS = 600;

  function addLog(s: string) {
    const stamp = new Date().toLocaleString();
    setLog((prev) => [`[${stamp}] ${s}`, ...prev].slice(0, 500));
  }
  const parseNum = (v: string | number, fb = 0) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : fb;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  async function handleUpload(file: File) {
    try {
      setBusy(true);
      addLog(`Valid fil: ${file.name}`);

      // 1) Hämta SAS
      addLog("Begär SAS-URL…");
      const sasRes = await fetch("/api/price-upload-sas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      const sasJson = await safeJson(sasRes);
      if (!sasRes.ok || !sasJson?.sasUrl) throw new Error(sasJson?.error || "SAS fel");
      addLog("SAS mottagen.");

      // 2) PUT blob
      addLog("Laddar upp filen till Blob Storage…");
      const headers: Record<string, string> = { "x-ms-blob-type": "BlockBlob" };
      headers["Content-Type"] = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/octet-stream");
      const put = await fetch(sasJson.sasUrl, { method: "PUT", headers, body: file });
      if (!put.ok) throw new Error(`Blob PUT ${put.status}: ${(await put.text()).slice(0, 200)}`);
      addLog("Uppladdning klar.");

      // 3) Chunkad serverbearbetning
      const fxNum = parseNum(fx, 0);
      const markupNum = parseNum(markup, 0);
      const roundModeApi = roundMode === "nearest" ? "near" : roundMode === "up" ? "up" : roundMode === "down" ? "down" : "near";
      const stepApi = roundMode === "none" ? 0 : Number(roundStep || 1);

      let offset = 0;
      let part = 1;
      let grand = { updated: 0, skipped: 0, notFound: 0, badRows: 0, total: 0 };

      while (true) {
        addLog(`Startar server-bearbetning (del ${part})… fx=${fxNum}, markup=${markupNum}, step=${stepApi}, round=${roundModeApi}, offset=${offset}, limit=${CHUNK_ROWS}`);

        const body = {
          container: sasJson.container,
          blobName: sasJson.blobName,
          fx: fxNum,
          markupPct: markupNum,
          roundMode: roundModeApi,
          step: stepApi,
          publish: !!pub,
          dryRun: !!dry,
          batchSize: INNER_BATCH,
          offset,
          limitRows: CHUNK_ROWS,
          csvDelimiter: delimiter,
        };

        const procRes = await fetch("/api/price-upload-from-blob", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = await safeJson(procRes);
        if (!procRes.ok || !out?.ok) {
          const msg = out?.error || out?.message || out?.raw || `HTTP ${procRes.status}`;
          throw new Error(`Bearbetning misslyckades: ${msg}`);
        }

        grand.updated  += Number(out.updated || 0);
        grand.skipped  += Number(out.skipped || 0);
        grand.notFound += Number(out.notFound || 0);
        grand.badRows  += Number(out.badRows || 0);
        grand.total     = Number(out.total || grand.total);

        addLog(
          `Del ${part} klar: rader ${out.range?.offset}–${(out.range?.end ?? 0) - 1}, ` +
          `updated=${out.updated}, skipped=${out.skipped}, notFound=${out.notFound}, bad=${out.badRows}`
        );

        const next = out.nextOffset as number | null;
        if (!next || next >= out.total) break;
        offset = next;
        part++;
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }

      addLog(
        `KLART: total=${grand.total}, updated=${grand.updated}, skipped=${grand.skipped}, notFound=${grand.notFound}, bad=${grand.badRows}`
      );
    } catch (e: any) {
      addLog(`Fel: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-xs opacity-70">Valutakurs (GBP→SEK)</label>
          <input className="w-full rounded-lg border px-3 py-2" value={String(fx)} onChange={(e) => setFx(parseNum(e.target.value, fx))} />
        </div>
        <div>
          <label className="text-xs opacity-70">Påslag (%)</label>
          <input className="w-full rounded-lg border px-3 py-2" value={String(markup)} onChange={(e) => setMarkup(parseNum(e.target.value, markup))} />
        </div>
        <div>
          <label className="text-xs opacity-70">Avrundning</label>
          <select className="w-full rounded-lg border px-3 py-2" value={roundMode} onChange={(e) => setRoundMode(e.target.value as RoundModeUI)}>
            <option value="nearest">Närmaste</option>
            <option value="up">Uppåt</option>
            <option value="down">Nedåt</option>
            <option value="none">Ingen</option>
          </select>
        </div>
        <div>
          <label className="text-xs opacity-70">Steg (SEK)</label>
          <select className="w-full rounded-lg border px-3 py-2" value={roundStep} onChange={(e) => setRoundStep(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
          </select>
        </div>
        <div>
          <label className="text-xs opacity-70">CSV-avgränsare</label>
          <select className="w-full rounded-lg border px-3 py-2" value={delimiter} onChange={(e) => setDelimiter(e.target.value as any)}>
            <option value=",">Komma (,)</option>
            <option value=";">Semikolon (;)</option>
            <option value="\t">Tab</option>
          </select>
        </div>
      </div>

      <label className="block rounded-lg border px-4 py-6 text-center cursor-pointer bg-white hover:bg-slate-50 font-semibold">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        {busy ? "Bearbetar…" : "Välj fil…"}
      </label>

      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-amber-600" checked={pub} onChange={() => setPub(!pub)} />
          Publicera direkt (annars draft)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-amber-600" checked={dry} onChange={() => setDry(!dry)} />
          Dry-run (visa bara vad som skulle ändras)
        </label>
        <span className="ml-auto text-xs opacity-60">Kör automatiskt 500 rader/körning</span>
      </div>

      <div className="rounded-lg border bg-slate-50 p-3 text-sm font-mono leading-relaxed h-64 overflow-auto">
        {log.length === 0 ? (
          <div className="text-slate-400">Inga händelser ännu.</div>
        ) : (
          <ul className="space-y-1">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
