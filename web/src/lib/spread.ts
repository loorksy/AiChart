/**
 * Spread computation — works for forex, crypto CFDs, and indices.
 *
 * Design: a "pip" is instrument-specific. For a crypto CFD like BCHUSDm
 * the "pip" that produces a meaningful number is NOT 0.0001; it makes more
 * sense to express the spread in price units or %, so we return spreadPips
 * only when it's < 10 000 (i.e. the denominator is sensible) and fall back
 * to spreadPct for large-price instruments.
 */

/** Standard pip size for well-known forex majors and minors. */
export function pipSizeForSymbol(symbol: string, midPrice?: number): number {
  const s = symbol.toUpperCase().replace(/M$/, ""); // strip broker suffix 'm' (BCHUSDm → BCHUSD)

  // JPY pairs: pip = 0.01
  if (s.includes("JPY") && !s.endsWith("USDT")) return 0.01;

  // Crypto via Binance spot (BTCUSDT, ETHUSDT…): tick = 0.01
  if (s.endsWith("USDT")) return 0.01;

  // Crypto CFD on MT5 broker (BTCUSDm → BTCUSD, BCHUSDm → BCHUSD…)
  // These have a mid price >> 1; derive a sensible "pip" from the price
  // magnitude rather than using the fixed forex pip 0.0001.
  const cryptoRoots = [
    "BTC", "ETH", "XBT", "LTC", "XRP", "BCH", "ADA", "BNB",
    "SOL", "DOT", "LINK", "UNI", "DOGE", "AVAX", "MATIC", "TRX", "EOS",
    "XAG", "XAU", // metals also have large prices
  ];
  for (const root of cryptoRoots) {
    if (s.startsWith(root)) {
      // Use mid price to derive pip magnitude (1 unit at the smallest displayed decimal)
      if (midPrice && midPrice > 0) {
        if (midPrice >= 10000) return 1;      // BTC ~64k → 1 USD per pip
        if (midPrice >= 100) return 0.01;     // BCH ~200 → 0.01 USD per pip
        if (midPrice >= 1) return 0.0001;
        return 0.00001;
      }
      return 0.01; // safe fallback for large-price crypto
    }
  }

  // Forex: standard 4-decimal pair
  return 0.0001;
}

export interface SpreadInfo {
  bid: number;
  ask: number;
  mid: number;
  spreadRaw: number;
  /** Spread in pips (may be large for crypto CFDs — prefer spreadPct for those). */
  spreadPips: number;
  spreadPct: number;
  /** True when spreadPips is instrument-meaningful (< 10 000). */
  spreadPipsReliable?: boolean;
}

/** Computes spread from bid/ask with correct pip size per instrument. */
export function spreadFromBidAsk(
  bid: number,
  ask: number,
  symbol?: string,
): SpreadInfo | null {
  if (bid <= 0 || ask <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  const spreadRaw = ask - bid;
  const spreadPct = (spreadRaw / mid) * 100;
  const pip = symbol
    ? pipSizeForSymbol(symbol, mid)
    : mid >= 10 ? 0.01 : 0.0001;
  const spreadPips = spreadRaw / pip;
  return {
    bid,
    ask,
    mid,
    spreadRaw,
    spreadPips,
    spreadPct,
    spreadPipsReliable: spreadPips < 10_000,
  };
}

export function formatSpreadAr(info: SpreadInfo | null): string {
  if (!info) return "—";
  if (info.spreadPipsReliable && info.spreadPips >= 0.1) {
    return `${info.spreadPips.toFixed(1)} نقطة`;
  }
  return `${info.spreadPct.toFixed(3)}%`;
}
