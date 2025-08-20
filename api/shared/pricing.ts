export type Rounding = "none" | "nearest-1" | "nearest-5" | "up-1" | "up-5";

export function roundPrice(v: number, mode: Rounding): number {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  const r = (m: number, f: (x:number)=>number) => f(n / m) * m;

  switch (mode) {
    case "nearest-1": return Math.round(n);
    case "nearest-5": return r(5, Math.round);
    case "up-1":      return Math.ceil(n);
    case "up-5":      return r(5, Math.ceil);
    default:          return Number(n.toFixed(2));
  }
}

export function gbpToSek(gbp: number, fxRate: number, markupPct: number, rounding: Rounding){
  const base = gbp * fxRate;
  const withMarkup = base * (1 + (markupPct || 0)/100);
  return roundPrice(withMarkup, rounding);
}