export type MarketType = "forex";

/** Canonical forex instrument identity. */
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
