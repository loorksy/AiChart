import { z } from "zod";

/** Shared Zod field shapes reused across tool catalogs. */
export const zSymbol = z.string();
export const zOptionalSymbol = z.string().optional();
export const zMarket = z.literal("forex").optional();
export const zInterval = z.string().optional();
export const zSide = z.enum(["buy", "sell"]);
export const zConfidence = z.number().min(0).max(100);
export const zOptionalConfidence = z.number().min(0).max(100).optional();
export const zTradeId = z.number().int().positive();
export const zChartDrawings = z.array(z.record(z.string(), z.unknown())).optional();

/** Catalog strategies that can produce server-owned backtested confidence. */
export const BACKTEST_STRATEGY_IDS = [
  "ema_trend_follow_v1",
  "rsi_mean_reversion_v1",
  "range_breakout_v1",
] as const;

export const zBacktestStrategyId = z.enum(BACKTEST_STRATEGY_IDS);
export const zBacktestTimeframe = z.enum([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
]);
