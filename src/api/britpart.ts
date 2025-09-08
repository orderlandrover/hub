// src/api/britpart.ts
export type ImportPayload = {
  ids: number[];                                  // valda Britpart-kategori-ID:n
  pageSize?: number;                              // t.ex. 200 (backend kan ignorera)
  roundingMode?: "none" | "nearest" | "up" | "down";
  roundTo?: number;                               // t.ex. 1 eller 5
};

export async function runImport(payload: ImportPayload) {
  const res = await fetch("/api/import-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}
