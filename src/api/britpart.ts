// src/api/britpart.ts
export type ImportPayload = {
  ids: number[];
  pageSize?: number;
  roundingMode?: "none" | "nearest" | "up" | "down";
  roundTo?: number;
};

export async function runImport(payload: ImportPayload) {
  const res = await fetch("/api/import-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const where = json?.where || "unknown";
    const err = json?.error || text || "Unknown backend error";
    throw new Error(`HTTP ${res.status} [${where}]: ${err}`);
  }
  return json ?? {};
}
