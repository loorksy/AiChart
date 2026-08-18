/** Unique profit targets in plan order (nearest first), cap 3. */
export function collectTakeProfits(
  action: string,
  takeProfit?: number | null,
  extras?: unknown,
): number[] {
  const raw: number[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      if (!raw.includes(v)) raw.push(v);
      return;
    }
    if (Array.isArray(v)) v.forEach(push);
  };
  push(extras);
  push(takeProfit);
  raw.sort((a, b) => (action === "sell" ? b - a : a - b));
  return raw.slice(0, 3);
}
