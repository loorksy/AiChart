/**
 * Lightweight chart-coordinate type retained by generic drawing helpers.
 * Pivot detection and all deterministic market-decision logic were removed.
 */
export interface Pivot {
  index: number;
  price: number;
  kind: "high" | "low";
}

/** Relative bar offset used only to anchor forecast drawings. */
export function barsAheadFor(index: number, candleCount: number): number {
  return index - (candleCount - 1);
}
