export type RoundModeUI = "none" | "nearest" | "up" | "down";

export async function runImport(opts: {
  ids: number[];
  pageSize?: number;
  roundingMode?: RoundModeUI;
  roundTo?: number;
  /** endast valda leaf-IDn (från probetabellen) */
  leafIds?: number[];
  /** valfritt: begränsa till specifika SKU */
  restrictSkus?: string[];
}) {
  const r = await fetch("/api/import-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const txt = await r.text();
  try {
    const json = txt ? JSON.parse(txt) : {};
    if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}: Backend call failure`);
    return json;
  } catch {
    if (!r.ok) throw new Error(`HTTP ${r.status}: Backend call failure`);
    return {};
  }
}
