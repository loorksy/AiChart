export type MarketType = "forex";

/** MetaTrader platform variant. */
export type MtPlatform = "mt4" | "mt5";

/** Maps forex orders to the user's configured execution backend. */
export interface ResolvedSymbol {
  raw: string;
  symbol: string;
  market: MarketType;
  displayName: string;
}

export interface UnifiedSnapshot {
  symbol: string;
  market: MarketType;
  price: number;
  change24hPct: number | null;
  high24h: number | null;
  low24h: number | null;
  summary: string;
  extra?: Record<string, unknown>;
}
