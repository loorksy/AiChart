/**
 * Spread computation for forex pairs and metals.
 */

/**
 * Standard pip size per instrument CLASS — static, never price-dependent.
 *
 * Values match the research-service SYMBOL_REGISTRY (gold pip_size 0.01) so
 * web-side cost evidence and the Python backtest engine agree. The previous
 * gold branch flipped 0.01 ↔ 0.0001 at a $1000 mid-price, producing a 100×
 * different spreadPips for the same quote depending on the day's price.
 */
export function pipSizeForSymbol(symbol: string, midPrice?: number): number {
  // Signature kept for existing callers; the price no longer changes the pip.
  void midPrice;
  const s = symbol.toUpperCase().replace(/M$/, "");

  if (s.includes("JPY")) return 0.01;
  if (s.startsWith("XAU")) return 0.01;
  if (s.startsWith("XAG")) return 0.001;

  return 0.0001;
}

export interface SpreadInfo {
  bid: number;
  ask: number;
  mid: number;
  spreadRaw: number;
  spreadPips: number;
  spreadPct: number;
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
