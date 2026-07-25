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

/**
 * Known catalog strategies at the time of writing — informational only.
 * The WEB CATALOG (web/src/lib/strategies/catalog.ts) is the single source of
 * truth; the server rejects unknown ids with 409 and, for BUY/SELL, requires a
 * statistically validated deployment for the exact symbol+timeframe. The MCP
 * schema therefore validates SHAPE (pattern), not membership — a generated
 * enum would churn the contract on every catalog wave.
 */
export const BACKTEST_STRATEGY_IDS = [
  "ema_trend_follow_v1",
  "rsi_mean_reversion_v1",
  "range_breakout_v1",
] as const;

export const BACKTEST_STRATEGY_ID_PATTERN = /^[a-z0-9_]+_v\d+$/;

export const zBacktestStrategyId = z
  .string()
  .min(3)
  .max(128)
  .regex(BACKTEST_STRATEGY_ID_PATTERN)
  .describe(
    "Server-validated catalog strategy id (e.g. ema_trend_follow_v1). Discover valid ids and their evidence with get_strategy_performance; unknown ids are rejected server-side.",
  );
export const zBacktestTimeframe = z.enum([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
]);
