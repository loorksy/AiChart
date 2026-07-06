/**
 * Spread computation for forex pairs and metals.
 */

/** Standard pip size for well-known forex majors and minors. */
export function pipSizeForSymbol(symbol: string, midPrice?: number): number {
  const s = symbol.toUpperCase().replace(/M$/, "");

  if (s.includes("JPY")) return 0.01;

  for (const root of ["XAU", "XAG"]) {
    if (s.startsWith(root)) {
      if (midPrice && midPrice > 0) {
        if (midPrice >= 1000) return 0.01;
        return 0.0001;
      }
      return 0.01;
    }
  }

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
