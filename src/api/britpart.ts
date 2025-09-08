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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(()=>"")}`);
  return res.json();
}
