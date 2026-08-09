export { buildForexSnapshot } from "./markets/forexSnapshot";

export interface MarketSnapshot {
  symbol: string;
  interval: string;
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  atr14: number | null;
  trend: "uptrend" | "downtrend" | "sideways";
  summary: string;
}
