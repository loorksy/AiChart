/**
 * Adaptive position sizing — NO static lot/notional. Scales the per-trade
 * notional by confidence (up), volatility (down) and existing exposure (down),
 * always clamped to the user's per-trade budget. Risk Guard + computeForexLots
 * remain the final authority on what actually executes.
 * Pure + unit-tested.
 */
export interface DynamicSizingInput {
  /** Baseline per-trade notional (effectiveCapital * per_trade_pct / 100). */
  baseNotional: number;
  confidence: number; // 0-100
  /** Stop distance as a fraction of entry (higher = more volatile → smaller). */
  riskFraction: number;
  /** Open exposure as a fraction of capacity (0-1, higher → smaller). */
  exposureFraction?: number;
  /** Hard ceiling for a single trade (e.g. effectiveCapital). */
  maxNotional: number;
}

/** Returns the adaptive notional, never above base*1.5 nor the hard ceiling. */
export function deriveDynamicNotional(input: DynamicSizingInput): number {
  const base = Math.max(0, input.baseNotional);
  if (base <= 0) return 0;

  // Confidence: 0.6× at 50, ~1.1× at 100, 0.6× floor below 50.
  const conf = Math.max(0, Math.min(100, input.confidence));
  const confFactor = 0.6 + Math.max(0, conf - 50) / 100; // 0.6 → 1.1

  // Volatility: wider stops shrink size. Normalize around 1% risk fraction.
  const rf = Math.max(0.001, input.riskFraction || 0.01);
  const volFactor = Math.min(1, 0.01 / rf); // ≤1; halves at 2% risk

  // Exposure: more open exposure → smaller new size.
  const exp = Math.max(0, Math.min(1, input.exposureFraction ?? 0));
  const expFactor = 1 - 0.5 * exp; // down to 0.5×

  let notional = base * confFactor * volFactor * expFactor;
  notional = Math.min(notional, base * 1.5, input.maxNotional);
  return Math.max(0, Number(notional.toFixed(2)));
}
