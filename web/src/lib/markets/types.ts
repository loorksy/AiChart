export type MarketType = "forex";

import { forexBrokerKind } from "../brokers/forexBackend";

/** Underlying broker/execution backend for forex orders. */
export type BrokerKind = "mt_ea" | "metaapi" | "mt5_local";

/** MetaTrader platform variant for the EA bridge. */
export type MtPlatform = "mt4" | "mt5";

/** Maps forex orders to the user's configured execution backend. */
export function brokerForMarket(_market: MarketType = "forex"): BrokerKind {
  return forexBrokerKind();
}

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
