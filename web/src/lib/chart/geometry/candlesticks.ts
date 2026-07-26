/**
 * Japanese candlestick detection for live analysis
 * (docs/UNIFIED_AGENT_PLAN.md §6).
 *
 * The platform could name a head and shoulders but not an engulfing candle:
 * candlestick recognition existed only inside the backtest DSL, so the live
 * agent had to describe rejection and absorption in prose and could not cite
 * the single bar that made a zone worth trading.
 *
 * Deterministic and ATR-relative, like the rest of the geometry engine — a
 * "long" body on gold and on a major are different numbers, and a fixed pip
 * threshold would find hammers everywhere on one and nowhere on the other.
 * These name a shape. Whether the shape matters is the decision engine's call.
 */
import type { GeometryCandle } from "./types";

export type CandlestickName =
  | "doji"
  | "hammer"
  | "inverted_hammer"
  | "shooting_star"
  | "hanging_man"
  | "marubozu_bullish"
  | "marubozu_bearish"
  | "spinning_top"
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "morning_star"
  | "evening_star"
  | "three_white_soldiers"
  | "three_black_crows"
  | "bullish_harami"
  | "bearish_harami"
  | "tweezer_top"
  | "tweezer_bottom";

export interface CandlestickSignal {
  name: CandlestickName;
  /** Index of the candle that COMPLETES the pattern. */
  index: number;
  time: number;
  bias: "bullish" | "bearish" | "neutral";
  /** 0–100, from how cleanly the shape matches — never a trade score. */
  strength: number;
  /** Bars the pattern spans (1 for single-candle shapes). */
  bars: number;
}

const DOJI_BODY_ATR = 0.08;
const LONG_BODY_ATR = 0.6;
const LONG_WICK_RATIO = 2;

interface Parts {
  body: number;
  upper: number;
  lower: number;
  range: number;
  bullish: boolean;
  bearish: boolean;
}

function parts(candle: GeometryCandle): Parts {
  const body = Math.abs(candle.close - candle.open);
  const upper = candle.high - Math.max(candle.open, candle.close);
  const lower = Math.min(candle.open, candle.close) - candle.low;
  return {
    body,
    upper: Math.max(0, upper),
    lower: Math.max(0, lower),
    range: Math.max(candle.high - candle.low, Number.EPSILON),
    bullish: candle.close > candle.open,
    bearish: candle.close < candle.open,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Short-term direction into a candle, so a hammer is told from a hanging man
 * and a star from a continuation. Reversal shapes only mean something against
 * a move they might reverse.
 */
function priorTrend(
  candles: readonly GeometryCandle[],
  index: number,
  lookback = 5,
): "up" | "down" | "flat" {
  const from = Math.max(0, index - lookback);
  if (index - from < 2) return "flat";
  const first = candles[from]!.close;
  const last = candles[index - 1]!.close;
  const move = last - first;
  const scale = Math.abs(first) * 0.0008;
  if (move > scale) return "up";
  if (move < -scale) return "down";
  return "flat";
}

/**
 * Detect candlestick shapes over the tail of a series.
 *
 * Returns the most recent signals first, bounded so the evidence bundle stays
 * readable — the last few bars are what a scalp is entering on.
 */
export function detectCandlesticks(input: {
  candles: readonly GeometryCandle[];
  atr: number;
  /** How many trailing candles to inspect. */
  lookback?: number;
  limit?: number;
}): CandlestickSignal[] {
  const { candles, atr } = input;
  if (candles.length < 3 || !(atr > 0)) return [];

  const lookback = Math.min(input.lookback ?? 30, candles.length);
  const start = Math.max(2, candles.length - lookback);
  const signals: CandlestickSignal[] = [];

  const push = (
    name: CandlestickName,
    index: number,
    bias: CandlestickSignal["bias"],
    strength: number,
    bars = 1,
  ) => {
    signals.push({
      name,
      index,
      time: candles[index]!.time,
      bias,
      strength: clamp(strength),
      bars,
    });
  };

  for (let i = start; i < candles.length; i++) {
    const c = candles[i]!;
    const p = parts(c);
    const prev = candles[i - 1]!;
    const prevParts = parts(prev);
    const trend = priorTrend(candles, i);

    // --- single-candle shapes ---
    if (p.body <= atr * DOJI_BODY_ATR) {
      push("doji", i, "neutral", 55 + (1 - p.body / (atr * DOJI_BODY_ATR)) * 25);
    } else if (
      p.body >= atr * LONG_BODY_ATR &&
      p.upper <= p.body * 0.1 &&
      p.lower <= p.body * 0.1
    ) {
      push(
        p.bullish ? "marubozu_bullish" : "marubozu_bearish",
        i,
        p.bullish ? "bullish" : "bearish",
        70 + (p.body / atr) * 10,
      );
    } else if (p.body <= p.range * 0.35 && p.upper > p.body && p.lower > p.body) {
      push("spinning_top", i, "neutral", 50);
    }

    // A hammer is defined by proportion, not by an absent opposite wick: the
    // lower shadow dominates the bar and the upper one is a fraction of it.
    // Requiring upper <= body missed almost every real hammer, whose body is
    // tiny by construction.
    const longLower =
      p.lower >= p.body * LONG_WICK_RATIO &&
      p.lower >= p.range * 0.5 &&
      p.upper <= p.lower * 0.35;
    const longUpper =
      p.upper >= p.body * LONG_WICK_RATIO &&
      p.upper >= p.range * 0.5 &&
      p.lower <= p.upper * 0.35;

    if (longLower && p.body > atr * DOJI_BODY_ATR) {
      // Same shape, opposite meaning by context — naming it correctly is the
      // whole point of tracking the prior move.
      if (trend === "down") push("hammer", i, "bullish", 60 + (p.lower / atr) * 12);
      else if (trend === "up") push("hanging_man", i, "bearish", 55 + (p.lower / atr) * 10);
    }
    if (longUpper && p.body > atr * DOJI_BODY_ATR) {
      if (trend === "up") push("shooting_star", i, "bearish", 60 + (p.upper / atr) * 12);
      else if (trend === "down") push("inverted_hammer", i, "bullish", 55 + (p.upper / atr) * 10);
    }

    // --- two-candle shapes ---
    const engulfsBody =
      Math.min(c.open, c.close) <= Math.min(prev.open, prev.close) &&
      Math.max(c.open, c.close) >= Math.max(prev.open, prev.close);
    if (engulfsBody && p.body > prevParts.body && prevParts.body > 0) {
      if (p.bullish && prevParts.bearish) {
        push("bullish_engulfing", i, "bullish", 65 + (p.body / atr) * 10, 2);
      } else if (p.bearish && prevParts.bullish) {
        push("bearish_engulfing", i, "bearish", 65 + (p.body / atr) * 10, 2);
      }
    }

    const insidePrevBody =
      Math.max(c.open, c.close) <= Math.max(prev.open, prev.close) &&
      Math.min(c.open, c.close) >= Math.min(prev.open, prev.close);
    if (insidePrevBody && prevParts.body >= atr * 0.4 && p.body < prevParts.body * 0.6) {
      if (prevParts.bearish) push("bullish_harami", i, "bullish", 58, 2);
      else if (prevParts.bullish) push("bearish_harami", i, "bearish", 58, 2);
    }

    const tweezerTol = atr * 0.1;
    if (Math.abs(c.high - prev.high) <= tweezerTol && trend === "up") {
      push("tweezer_top", i, "bearish", 55, 2);
    }
    if (Math.abs(c.low - prev.low) <= tweezerTol && trend === "down") {
      push("tweezer_bottom", i, "bullish", 55, 2);
    }

    // --- three-candle shapes ---
    if (i >= 2) {
      const first = candles[i - 2]!;
      const firstParts = parts(first);
      const middle = prev;
      const middleParts = prevParts;
      const smallMiddle = middleParts.body <= firstParts.body * 0.5;

      if (
        firstParts.bearish &&
        smallMiddle &&
        p.bullish &&
        c.close > first.open - firstParts.body * 0.5 &&
        firstParts.body >= atr * 0.4
      ) {
        push("morning_star", i, "bullish", 70, 3);
      }
      if (
        firstParts.bullish &&
        smallMiddle &&
        p.bearish &&
        c.close < first.open + firstParts.body * 0.5 &&
        firstParts.body >= atr * 0.4
      ) {
        push("evening_star", i, "bearish", 70, 3);
      }

      const three = [first, middle, c];
      const allBull = three.every((candle) => candle.close > candle.open);
      const allBear = three.every((candle) => candle.close < candle.open);
      const rising = middle.close > first.close && c.close > middle.close;
      const falling = middle.close < first.close && c.close < middle.close;
      const bodiesReal = three.every((candle) => Math.abs(candle.close - candle.open) >= atr * 0.3);
      if (allBull && rising && bodiesReal) push("three_white_soldiers", i, "bullish", 72, 3);
      if (allBear && falling && bodiesReal) push("three_black_crows", i, "bearish", 72, 3);
    }
  }

  // Most recent first: a scalp cares about the bar it is entering on.
  signals.sort((a, b) => b.index - a.index || b.strength - a.strength);
  return signals.slice(0, input.limit ?? 8);
}

/** Compact operator-facing lines for the evidence bundle. */
