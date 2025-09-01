import React, { useState } from "react";

type ProcessResult = {
  ok: boolean;
  total?: number;
  processed?: number;
  updated?: number;
  skipped?: number;
  notFound?: number;
  badRows?: number;
  sample?: any;
  error?: string;
};

export default function PriceUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const pushLog = (m: string) =>
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${m}`]);

  async function handleUpload() {
    try {
      if (!file) return;
      setBusy(true);
      setResult(null);
      setLog([]);
      pushLog(`Vald fil: ${file.name}`);

      // 1) Hämta SAS
      pushLog("Begär SAS-URL…");
      const sasRes = await fetch("/api/price-upload-sas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      if (!sasRes.ok) {
        const t = await sasRes.text();
        throw new Error(`SAS error ${sasRes.status}: ${t}`);
      }
      const { sasUrl, container, blobName } = await sasRes.json();
      if (!sasUrl || !container || !blobName) {
        throw new Error("Ogiltigt svar från SAS-endpoint");
      }
      pushLog("SAS mottagen.");

      // 2) PUT:a filen till SAS-URL
      pushLog("Laddar upp filen till Blob Storage…");
      const put = await fetch(sasUrl, {
        method: "PUT",
        headers: {
          "x-ms-blob-type": "BlockBlob",
          "Content-Type": file.type || "text/csv",
        },
        body: file,
      });
      if (!put.ok) {
        const t = await put.text();
        throw new Error(`Upload failed ${put.status}: ${t}`);
      }
      pushLog("Uppladdning klar.");

      // 3) Trigga server-bearbetning från blob
      pushLog("Startar server-bearbetning…");
      const proc = await fetch("/api/price-upload-from-blob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          container,
          blobName,
          publish: false,  // ändra till true om du vill publicera samtidigt
          dryRun: false,   // sätt true för att testa utan att skriva till Woo
          fx: 13.0,
          markupPct: 0,
          roundMode: "near",
          step: 1,
        }),
      });
      const resJson: ProcessResult = await proc.json();
      if (!proc.ok || !resJson.ok) {
        throw new Error(resJson.error || `Process failed ${proc.status}`);
      }
      setResult(resJson);
      pushLog("Bearbetning klar.");
    } catch (e: any) {
      const msg = e?.message || String(e);
      pushLog(`Fel: ${msg}`);
      alert(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Prisimport (CSV → WooCommerce)</h1>

      <div className="grid gap-4 rounded-2xl p-4 border">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          disabled={busy}
          className="block w-full cursor-pointer"
        />

        <button
          onClick={handleUpload}
          disabled={!file || busy}
          className="px-4 py-2 rounded-xl border shadow-sm hover:shadow disabled:opacity-50"
        >
          {busy ? "Jobbar…" : "Ladda upp och bearbeta"}
        </button>
      </div>

      {log.length > 0 && (
        <div className="rounded-2xl border p-4">
          <div className="font-medium mb-2">Logg</div>
          <pre className="text-sm whitespace-pre-wrap">{log.join("\n")}</pre>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border p-4">
          <div className="font-medium mb-2">Resultat</div>
          <ul className="text-sm grid gap-1">
            <li><b>Rader totalt:</b> {result.total}</li>
            <li><b>Bearbetade:</b> {result.processed}</li>
            <li><b>Uppdaterade:</b> {result.updated}</li>
            <li><b>Skippade:</b> {result.skipped}</li>
            <li><b>Ej hittade:</b> {result.notFound}</li>
            <li><b>Felaktiga rader:</b> {result.badRows}</li>
          </ul>
          {result.sample && (
            <details className="mt-3">
              <summary className="cursor-pointer">Visa sample</summary>
              <pre className="text-xs whitespace-pre-wrap mt-2">
                {JSON.stringify(result.sample, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
