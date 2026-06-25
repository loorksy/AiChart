/**
 * Japanese candlestick entry signals for XAUUSD gold bot.
 * Priority: Engulfing → Hammer/Hanging Man → Shooting Star → XANDER body fallback.
 */
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import type { GoldEntryPattern, GoldEntrySignal } from "./goldTypes";

const EPS = 1e-9;

function body(c: OhlcCandle): number {
  return Math.abs(c.close - c.open);
}

function upperShadow(c: OhlcCandle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerShadow(c: OhlcCandle): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c: OhlcCandle): boolean {
  return c.close > c.open;
}

function isBearish(c: OhlcCandle): boolean {
  return c.close < c.open;
}

/** Long lower shadow, small body at top — bullish reversal shape. */
export function isHammer(c: OhlcCandle): boolean {
  const b = body(c);
  const range = c.high - c.low;
  if (range <= 0 || b <= 0) return false;
  const ls = lowerShadow(c);
  const us = upperShadow(c);
  return ls >= b * 2 && us <= b + EPS && b / range < 0.35;
}

/** Same shape as hammer — interpreted as bearish at highs. */
export function isHangingMan(c: OhlcCandle): boolean {
  return isHammer(c);
}

/** Long upper shadow, small body at bottom — bearish. */
export function isShootingStar(c: OhlcCandle): boolean {
  const b = body(c);
  const range = c.high - c.low;
  if (range <= 0 || b <= 0) return false;
  const us = upperShadow(c);
  const ls = lowerShadow(c);
  return us >= b * 2 && ls <= b + EPS && b / range < 0.35;
}

export function isBullishEngulfing(prev: OhlcCandle, curr: OhlcCandle): boolean {
  return (
    isBearish(prev) &&
    isBullish(curr) &&
    curr.open <= prev.close &&
    curr.close >= prev.open
  );
}

export function isBearishEngulfing(prev: OhlcCandle, curr: OhlcCandle): boolean {
  return (
    isBullish(prev) &&
    isBearish(curr) &&
    curr.open >= prev.close &&
    curr.close <= prev.open
  );
}

/** Last fully closed candle (excludes the forming bar when ≥2 bars exist). */
export function lastClosedCandle(candles: OhlcCandle[]): OhlcCandle | null {
  if (candles.length === 0) return null;
  if (candles.length === 1) return candles[0]!;
  return candles[candles.length - 2]!;
}

/**
 * Resolve entry side from recent OHLC. Returns null when insufficient data.
 */
export function resolveGoldEntrySignal(
  candles: OhlcCandle[],
): GoldEntrySignal | null {
  const closed = lastClosedCandle(candles);
  if (!closed) return null;

  const idx = candles.indexOf(closed);
  const prev = idx > 0 ? candles[idx - 1]! : null;

  if (prev) {
    if (isBullishEngulfing(prev, closed)) {
      return { side: "buy", pattern: "bullish_engulfing" };
    }
    if (isBearishEngulfing(prev, closed)) {
      return { side: "sell", pattern: "bearish_engulfing" };
    }
  }

  if (isHammer(closed)) {
    return { side: "buy", pattern: "hammer" };
  }
  if (isHangingMan(closed)) {
    return { side: "sell", pattern: "hanging_man" };
  }
  if (isShootingStar(closed)) {
    return { side: "sell", pattern: "shooting_star" };
  }

  // XANDER-style fallback: direction of last closed candle body.
  if (closed.close > closed.open) {
    return { side: "buy", pattern: "xander_body" };
  }
  if (closed.close < closed.open) {
    return { side: "sell", pattern: "xander_body" };
  }
  return { side: "buy", pattern: "xander_body" };
}

export const PATTERN_LABELS: Record<GoldEntryPattern, string> = {
  bullish_engulfing: "ابتلاع صعودي",
  bearish_engulfing: "ابتلاع هبوطي",
  hammer: "مطرقة",
  hanging_man: "شنق",
  shooting_star: "نجمة الرماية",
  xander_body: "اتجاه الشمعة",
};
