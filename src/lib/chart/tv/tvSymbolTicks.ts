/**
 * The ONE price-step rule for TradingView symbol info and tick math.
 *
 * The datafeed reports `minmov`/`pricescale` to the library, and the library
 * reconstructs the RiskReward position tool's prices as
 * `entry ± level × minmov / pricescale` (its `ownerSourceBase()` is exactly
 * `pricescale / minmov`). The drawing adapter must therefore convert price
 * distances to levels with the SAME numbers the datafeed reported — sharing
 * this module is what keeps the two sides arithmetically identical, XAUUSD's
 * 2-decimal tick included.
 */

/** Reported to TradingView as `minmov` for every platform symbol. */
export const SYMBOL_MINMOV = 1;

/** Reported to TradingView as `pricescale` (10^decimals). */
export function symbolPriceScale(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("JPY")) return 1000; // 3 decimals
  if (s.includes("XAU") || s.includes("XAG")) return 100; // metals, 2 decimals
  return 100000; // forex majors, 5 decimals
}

/** Ticks per 1.0 of price — TradingView's `ownerSourceBase` for the symbol. */
export function ticksPerPriceUnit(symbol: string): number {
  return symbolPriceScale(symbol) / SYMBOL_MINMOV;
}
