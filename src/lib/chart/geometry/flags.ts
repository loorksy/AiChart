/**
 * Flags and pennants: an impulse leg followed by a shallow counter-trend
 * consolidation, completed on a breakout in the impulse direction.
 *
 * Impulse: a net move ≥ 2.5×ATR over 5–10 bars. The consolidation is built
 * ADAPTIVELY bar by bar: it ends the moment a close escapes the range built
 * so far (that close is the breakout/invalidation candle), or when it
 * overstays 20 bars. A fixed-window measurement would swallow the breakout
 * candles into the "consolidation" and reject the whole structure.
 */
import type { GeometryCandle, GeometryDetectorInput, PatternInstance } from "./types";
import { clampConfidence } from "./types";
import { projectMeasuredMove, stateConfidence, BREAK_BUFFER_ATR } from "./patternState";

const IMPULSE_MIN_ATR = 2.5;
const IMPULSE_MIN_BARS = 5;
const IMPULSE_MAX_BARS = 10;
const CONSOLIDATION_MIN_BARS = 3;
const CONSOLIDATION_MAX_BARS = 20;
const CONSOLIDATION_MAX_RANGE_ATR = 1.6;
const MAX_RETRACE_RATIO = 0.6;
/** Pennant: the late half of the consolidation is this much narrower. */
const PENNANT_NARROWING_RATIO = 0.6;
/** Ignore structures whose resolution is buried deeper than this. */
const MAX_STALENESS_BARS = 10;

interface ConsolidationResult {
  endIndex: number;
  high: number;
  low: number;
  converging: boolean;
  resolution: "breakout" | "breakdown" | "open";
  resolutionIndex?: number;
}

/** Grow the consolidation until a close escapes it (or the window closes). */
function buildConsolidation(
  candles: readonly GeometryCandle[],
  startIndex: number,
  direction: "up" | "down",
  atr: number,
): ConsolidationResult | null {
  const tol = Math.max(atr * BREAK_BUFFER_ATR, Number.EPSILON);
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  const ranges: number[] = [];
  let end = startIndex;

  for (
    let i = startIndex;
    i < candles.length && i <= startIndex + CONSOLIDATION_MAX_BARS;
    i++
  ) {
    const candle = candles[i]!;
    const bars = i - startIndex;
    if (bars >= CONSOLIDATION_MIN_BARS) {
      // A close escaping the range built SO FAR resolves the consolidation.
      if (direction === "up" && candle.close > high + tol) {
        return finish(i, "breakout");
      }
      if (direction === "down" && candle.close < low - tol) {
        return finish(i, "breakout");
      }
      if (direction === "up" && candle.close < low - tol) {
        return finish(i, "breakdown");
      }
      if (direction === "down" && candle.close > high + tol) {
        return finish(i, "breakdown");
      }
    }
    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
    ranges.push(candle.high - candle.low);
    end = i;
  }
  if (end - startIndex < CONSOLIDATION_MIN_BARS) return null;
  return finish(undefined, "open");

  function finish(
    resolutionIndex: number | undefined,
    resolution: ConsolidationResult["resolution"] | "breakdown",
  ): ConsolidationResult {
    const mid = Math.floor(ranges.length / 2);
    const width = (slice: number[]) =>
      slice.length ? Math.max(...slice) : 0;
    const early = width(ranges.slice(0, mid));
    const late = width(ranges.slice(mid));
    return {
      endIndex: end,
      high,
      low,
      converging: early > 0 && late <= early * PENNANT_NARROWING_RATIO,
      resolution: resolution as ConsolidationResult["resolution"],
      resolutionIndex,
    };
  }
}

export function detectFlags(input: GeometryDetectorInput): PatternInstance[] {
  const { candles, atr } = input;
  if (atr <= 0 || candles.length < IMPULSE_MIN_BARS + 8) return [];

  // Scan impulse legs newest-first; the most recent valid structure wins.
  for (
    let impulseEnd = candles.length - CONSOLIDATION_MIN_BARS - 1;
    impulseEnd >= IMPULSE_MIN_BARS;
    impulseEnd--
  ) {
    for (let span = IMPULSE_MIN_BARS; span <= IMPULSE_MAX_BARS; span++) {
      const impulseStart = impulseEnd - span;
      if (impulseStart < 0) break;
      const from = candles[impulseStart]!;
      const to = candles[impulseEnd]!;
      const net = to.close - from.open;
      if (Math.abs(net) < IMPULSE_MIN_ATR * atr) continue;
      const direction: "up" | "down" = net > 0 ? "up" : "down";

      const consolidation = buildConsolidation(candles, impulseEnd, direction, atr);
      if (!consolidation) continue;
      const consolidationRange = consolidation.high - consolidation.low;
      if (consolidationRange > CONSOLIDATION_MAX_RANGE_ATR * atr) continue;

      // Shallow retracement only — a deep pullback is not a flag.
      const retrace =
        direction === "up"
          ? (to.close - consolidation.low) / Math.abs(net)
          : (consolidation.high - to.close) / Math.abs(net);
      if (retrace > MAX_RETRACE_RATIO) continue;

      let status: PatternInstance["status"];
      if (consolidation.resolution === "breakout") {
        status = "completed";
      } else if (consolidation.resolution === "breakdown") {
        status = "invalidated";
      } else {
        status =
          candles.length - 1 - impulseEnd > CONSOLIDATION_MAX_BARS
            ? "invalidated"
            : "forming";
      }

      // Old, resolved-away formations are noise — only report structures
      // whose resolution (or formation) reaches the recent tail.
      const lastRelevant = consolidation.resolutionIndex ?? candles.length - 1;
      if (candles.length - 1 - lastRelevant > MAX_STALENESS_BARS) continue;

      const boundary =
        direction === "up" ? consolidation.high : consolidation.low;
      const base =
        56 +
        Math.min(12, (Math.abs(net) / atr - IMPULSE_MIN_ATR) * 4) +
        Math.min(8, (1 - retrace) * 10);

      return [
        {
          patternType: consolidation.converging ? "pennant" : "flag",
          status,
          anchors: [
            {
              index: impulseStart,
              time: from.time,
              price: direction === "up" ? from.low : from.high,
              kind: direction === "up" ? "low" : "high",
            },
            {
              index: impulseEnd,
              time: to.time,
              price: direction === "up" ? to.high : to.low,
              kind: direction === "up" ? "high" : "low",
            },
            {
              index: consolidation.endIndex,
              time: candles[consolidation.endIndex]!.time,
              price: direction === "up" ? consolidation.low : consolidation.high,
              kind: direction === "up" ? "low" : "high",
            },
          ],
          projectedTarget: projectMeasuredMove(boundary, Math.abs(net), direction),
          breakDirection: direction,
          confidence: clampConfidence(stateConfidence(base, status)),
          evidence: [
            `impulse=${(Math.abs(net) / atr).toFixed(2)}atr/${span}bars`,
            `retrace=${(retrace * 100).toFixed(0)}%`,
            consolidation.converging ? "converging (pennant)" : "parallel (flag)",
          ],
        },
      ];
    }
  }
  return [];
}
