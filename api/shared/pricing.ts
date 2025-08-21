export type RoundMode = "near" | "up" | "down" | "none";

export function roundToStep(v: number, step: number, mode: RoundMode) {
  if (!step || step <= 0 || mode === "none") return v;
  const m = v / step;
  if (mode === "near") return Math.round(m) * step;
  if (mode === "up")   return Math.ceil(m) * step;
  return Math.floor(m) * step;
}

export function calcSEK(gbp: number, fx: number, markupPct: number, step: number, mode: RoundMode) {
  const raw = gbp * fx * (1 + (markupPct || 0) / 100);
  return roundToStep(raw, step, mode);
}