/**
 * Structure-event detection: BOS (Break of Structure), CHoCH (Change of
 * Character), and MSS (Market Structure Shift with displacement).
 *
 * Pure candle math — no I/O, no LLM, deterministic and unit-testable.
 * A break requires a CLOSE beyond the swing level (a wick-only poke is a sweep,
 * not a break). When detection is uncertain, nothing is emitted — the engine
 * never fakes structure.
 */
import type { AgentCandle, Swing } from "./detectors";

export type StructureEvent = {
  type: "BOS" | "CHoCH" | "MSS";
  direction: "bullish" | "bearish";
  brokenLevel: number;
  breakCandleTime: number;
  confirmationClose: number;
  strength: number; // 0–100
  source: "swing" | "internal" | "htf";
};

/**
 * Walk the swings chronologically, tracking the running trend implied by the
 * sequence of breaks:
 * - Break WITH the current trend  → BOS (continuation).
 * - First close-through AGAINST the current trend → CHoCH.
 * - CHoCH with strong displacement (body ≥ 1.5 ATR or immediate follow-through)
 *   → upgraded to MSS.
 */
export function detectStructureEvents(
  candles: AgentCandle[],
  swings: Swing[],
  atr: number | null,
): StructureEvent[] {
  if (candles.length < 10 || swings.length < 1) return [];
  const effAtr = atr && atr > 0 ? atr : approxAtr(candles);
  if (!effAtr) return [];

  const events: StructureEvent[] = [];
  // Trend implied by structure so far: 1 bullish, -1 bearish, 0 unknown.
  let trend: 1 | -1 | 0 = 0;
  // The most recent unbroken swing high/low we track for breaks.
  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;

  const swingsByTime = [...swings].sort((a, b) => a.time - b.time);
  let swingIdx = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;

    // Fold in swings that formed up to this candle.
    while (swingIdx < swingsByTime.length && swingsByTime[swingIdx]!.time <= c.time) {
      const s = swingsByTime[swingIdx]!;
      if (s.type === "high") lastHigh = s;
      else lastLow = s;
      swingIdx++;
    }

    // Bullish break: close above the tracked swing high.
    if (lastHigh && c.close > lastHigh.price && c.time > lastHigh.time) {
      const ev = classifyBreak({
        direction: "bullish",
        trend,
        level: lastHigh.price,
        candle: c,
        next: candles[i + 1],
        atr: effAtr,
      });
      if (ev) {
        events.push(ev);
        trend = 1;
      }
      lastHigh = null; // consumed
    }

    // Bearish break: close below the tracked swing low.
    if (lastLow && c.close < lastLow.price && c.time > lastLow.time) {
      const ev = classifyBreak({
        direction: "bearish",
        trend,
        level: lastLow.price,
        candle: c,
        next: candles[i + 1],
        atr: effAtr,
      });
      if (ev) {
        events.push(ev);
        trend = -1;
      }
      lastLow = null; // consumed
    }
  }

  return events.slice(-20);
}

export function latestStructureEvent(
  events: StructureEvent[],
): StructureEvent | null {
  return events.at(-1) ?? null;
}

function classifyBreak(input: {
  direction: "bullish" | "bearish";
  trend: 1 | -1 | 0;
  level: number;
  candle: AgentCandle;
  next: AgentCandle | undefined;
  atr: number;
}): StructureEvent | null {
  const { direction, trend, level, candle, next, atr } = input;
  const dirSign = direction === "bullish" ? 1 : -1;

  // Displacement of the breaking candle beyond the level, in ATR units.
  const closeBeyond = Math.abs(candle.close - level);
  const displacementAtr = closeBeyond / atr;
  const bodySize = Math.abs(candle.close - candle.open);
  const bodyAtr = bodySize / atr;

  // Follow-through: next candle continues in the break direction.
  const followThrough =
    next != null && Math.sign(next.close - next.open) === dirSign;

  let strength = 0;
  strength += Math.min(40, Math.round(displacementAtr * 40));
  strength += Math.min(30, Math.round(bodyAtr * 20));
  if (followThrough) strength += 20;
  strength = Math.max(5, Math.min(100, strength));

  const withTrend =
    trend === 0 || (direction === "bullish" ? trend === 1 : trend === -1);

  const type: StructureEvent["type"] = withTrend
    ? "BOS"
    : bodyAtr >= 1.5 || (displacementAtr >= 1 && followThrough)
      ? "MSS"
      : "CHoCH";

  return {
    type,
    direction,
    brokenLevel: level,
    breakCandleTime: candle.time,
    confirmationClose: candle.close,
    strength,
    source: "swing",
  };
}

function approxAtr(candles: AgentCandle[]): number | null {
  const window = candles.slice(-14);
  const trs = window.map((c) => c.high - c.low).filter((x) => x > 0);
  if (!trs.length) return null;
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}
