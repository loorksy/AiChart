/**
 * Lightweight, allocation-cheap momentum signals for the scalp loop. Pure
 * functions over recent candles — no I/O, no LLM — so they run tick-by-tick.
 */

export interface MomentumCandle {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Momentum {
  emaFast: number;
  emaSlow: number;
  /** % change of the last close vs `lookback` candles ago. */
  slopePct: number;
  lastCandleBullish: boolean;
  /** Trailing run of up/down candles at the series end. */
  consecutiveUp: number;
  consecutiveDown: number;
  trend: "up" | "down" | "flat";
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0]!;
  for (let i = 1; i < values.length; i++) {
    e = values[i]! * k + e * (1 - k);
  }
  return e;
}

export interface MomentumOptions {
  fastPeriod?: number;
  slowPeriod?: number;
  /** Candles back for slope. */
  lookback?: number;
  /** |slopePct| below this is treated as flat. */
  flatThresholdPct?: number;
}

/**
 * Computes momentum from base candles (oldest → newest). Designed for fast
 * intervals (1m–5m); pass at least `slowPeriod` candles for a meaningful EMA.
 */
export function computeMomentum(
  candles: MomentumCandle[],
  opts: MomentumOptions = {},
): Momentum {
  const fastPeriod = opts.fastPeriod ?? 9;
  const slowPeriod = opts.slowPeriod ?? 21;
  const lookback = opts.lookback ?? 5;
  const flat = opts.flatThresholdPct ?? 0.02;

  if (candles.length === 0) {
    return {
      emaFast: 0,
      emaSlow: 0,
      slopePct: 0,
      lastCandleBullish: false,
      consecutiveUp: 0,
      consecutiveDown: 0,
      trend: "flat",
    };
  }

  const closes = candles.map((c) => c.close);
  const emaFast = ema(closes.slice(-Math.max(fastPeriod * 3, fastPeriod)), fastPeriod);
  const emaSlow = ema(closes.slice(-Math.max(slowPeriod * 3, slowPeriod)), slowPeriod);

  const last = candles[candles.length - 1]!;
  const refIdx = Math.max(0, closes.length - 1 - lookback);
  const ref = closes[refIdx]!;
  const slopePct = ref !== 0 ? ((last.close - ref) / ref) * 100 : 0;

  let consecutiveUp = 0;
  let consecutiveDown = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i]!;
    if (c.close > c.open) {
      if (consecutiveDown > 0) break;
      consecutiveUp++;
    } else if (c.close < c.open) {
      if (consecutiveUp > 0) break;
      consecutiveDown++;
    } else {
      break;
    }
  }

  let trend: Momentum["trend"] = "flat";
  if (emaFast > emaSlow && slopePct > flat) trend = "up";
  else if (emaFast < emaSlow && slopePct < -flat) trend = "down";

  return {
    emaFast,
    emaSlow,
    slopePct,
    lastCandleBullish: last.close > last.open,
    consecutiveUp,
    consecutiveDown,
    trend,
  };
}
