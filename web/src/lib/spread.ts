/** Standard pip size for forex pairs (JPY quotes use 0.01). */
export function pipSizeForSymbol(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("JPY") && !s.endsWith("USDT")) return 0.01;
  if (s.endsWith("USDT") || s.endsWith("USD") && s.length > 6) return 0.01;
  return 0.0001;
}

export interface SpreadInfo {
  bid: number;
  ask: number;
  mid: number;
  spreadRaw: number;
  spreadPips: number;
  spreadPct: number;
}

/** Computes spread from bid/ask — works for forex and crypto. */
export function spreadFromBidAsk(
  bid: number,
  ask: number,
  symbol?: string,
): SpreadInfo | null {
  if (bid <= 0 || ask <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  const spreadRaw = ask - bid;
  const spreadPct = (spreadRaw / mid) * 100;
  const pip = symbol ? pipSizeForSymbol(symbol) : mid >= 10 ? 0.01 : 0.0001;
  const spreadPips = spreadRaw / pip;
  return { bid, ask, mid, spreadRaw, spreadPips, spreadPct };
}

export function formatSpreadAr(info: SpreadInfo | null): string {
  if (!info) return "—";
  if (info.spreadPips >= 0.1 && info.spreadPips < 1000) {
    return `${info.spreadPips.toFixed(1)} نقطة`;
  }
  return `${info.spreadPct.toFixed(3)}%`;
}
