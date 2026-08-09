/** Notional simulation capital for historical research — never live broker equity. */
export const DEFAULT_BACKTEST_NOTIONAL_CAPITAL = 10_000;
export const DEFAULT_BACKTEST_ACCOUNT_CURRENCY = "USD";

export function resolveBacktestNotionalCapital(
  value: number | null | undefined,
): number {
  if (value == null || !Number.isFinite(value)) {
    return DEFAULT_BACKTEST_NOTIONAL_CAPITAL;
  }
  if (value < 100 || value > 10_000_000) {
    throw new Error(
      "notional_capital must be between 100 and 10,000,000 (simulation capital only; not live broker equity)",
    );
  }
  return value;
}
