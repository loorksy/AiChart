export type MarketType = "crypto" | "forex";

import { forexBrokerKind } from "../brokers/forexBackend";

/** Underlying broker/execution backend for a market. */
export type BrokerKind = "binance" | "mt_ea" | "metaapi" | "mt5_local";

/** MetaTrader platform variant for the EA bridge. */
export type MtPlatform = "mt4" | "mt5";

/** Maps a market to the broker that executes its orders. */
export function brokerForMarket(market: MarketType): BrokerKind {
  return market === "forex" ? forexBrokerKind() : "binance";
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
