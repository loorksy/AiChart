/**
 * Canonical trendline-evidence contract. A structural trendline must not be
 * drawn merely because two nearby candle points can be connected.
 */
import type { AgentCandle } from "../marketContext/detectors";

export const TRENDLINE_EVIDENCE_POLICY_VERSION = "1.0.0";

export type TrendlineDirection = "support" | "resistance";

export interface TrendlineAnchor {
  time: number;
  price: number;
  candleIndex: number;
  pivot: "swing_high" | "swing_low";
}

export interface TrendlineEvidence {
  policyVersion: string;
  direction: TrendlineDirection;
  timeframe: string;
  anchors: TrendlineAnchor[];
  independentTouches: number;
  candleSeparation: number;
  timeSeparationMs: number;
  priceDistance: number;
  atrNormalizedDistance: number;
  slope: number;
  evidenceScore: number;
  sourceDetector: "confirmed_swing_pivots";
  reason: string;
  rejectionReason?: string;
  broken: boolean;
}

export interface TrendlineProposal {
  accepted: boolean;
  evidence: TrendlineEvidence;
}

const MIN_CANDLE_SEPARATION = 8;
const MIN_TIME_BARS = 8;
const MIN_ATR_DISTANCE = 0.35;
const MIN_EVIDENCE_SCORE = 60;
const PIVOT_LOOKBACK = 3;

function confirmedPivots(
  candles: AgentCandle[],
  side: "low" | "high",
): Array<{ candle: AgentCandle; index: number }> {
  const out: Array<{ candle: AgentCandle; index: number }> = [];
  const lb = PIVOT_LOOKBACK;
  for (let i = lb; i < candles.length - lb; i++) {
    const c = candles[i]!;
    const price = side === "low" ? c.low : c.high;
    let ok = true;
    for (let j = 1; j <= lb; j++) {
      if (side === "low") {
        if (price > candles[i - j]!.low || price > candles[i + j]!.low) {
          ok = false;
          break;
        }
      } else if (price < candles[i - j]!.high || price < candles[i + j]!.high) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ candle: c, index: i });
  }
  return out;
}

function linePriceAt(
  a: TrendlineAnchor,
  b: TrendlineAnchor,
  time: number,
): number {
  if (b.time === a.time) return a.price;
  const t = (time - a.time) / (b.time - a.time);
  return a.price + t * (b.price - a.price);
}

function countTouches(
  candles: AgentCandle[],
  a: TrendlineAnchor,
  b: TrendlineAnchor,
  side: "low" | "high",
  atr: number,
): number {
  const tol = Math.max(atr * 0.15, Number.EPSILON);
  let touches = 0;
  for (const c of candles) {
    if (c.time < a.time || c.time > b.time) continue;
    const expected = linePriceAt(a, b, c.time);
    const price = side === "low" ? c.low : c.high;
    if (Math.abs(price - expected) <= tol) touches += 1;
  }
  return Math.max(touches, 2);
}

function isBroken(
  candles: AgentCandle[],
  a: TrendlineAnchor,
  b: TrendlineAnchor,
  side: "low" | "high",
  atr: number,
): boolean {
  const tol = Math.max(atr * 0.25, Number.EPSILON);
  for (const c of candles) {
    if (c.time <= b.time) continue;
    const expected = linePriceAt(a, b, c.time);
    if (side === "low" && c.close < expected - tol) return true;
    if (side === "high" && c.close > expected + tol) return true;
  }
  return false;
}

function reject(
  partial: Omit<TrendlineEvidence, "rejectionReason"> & {
    rejectionReason: string;
  },
): TrendlineProposal {
  return {
    accepted: false,
    evidence: { ...partial, evidenceScore: 0 },
  };
}

/**
 * Propose a structural trendline from confirmed swing pivots only.
 * Returns rejected proposals with explicit reasons — never a tiny zigzag.
 */
export function proposeStructuralTrendline(input: {
  candles: AgentCandle[];
  timeframe: string;
  atr: number | null;
}): TrendlineProposal {
  const candles = input.candles;
  const atr = input.atr && input.atr > 0 ? input.atr : null;
  const base = {
    policyVersion: TRENDLINE_EVIDENCE_POLICY_VERSION,
    timeframe: input.timeframe,
    sourceDetector: "confirmed_swing_pivots" as const,
    broken: false,
    independentTouches: 0,
    candleSeparation: 0,
    timeSeparationMs: 0,
    priceDistance: 0,
    atrNormalizedDistance: 0,
    slope: 0,
    evidenceScore: 0,
    anchors: [] as TrendlineAnchor[],
    reason: "",
  };

  if (candles.length < 40) {
    return reject({
      ...base,
      direction: "support",
      reason: "insufficient history for structural trendline",
      rejectionReason: `need at least 40 candles, have ${candles.length}`,
    });
  }
  if (atr == null) {
    return reject({
      ...base,
      direction: "support",
      reason: "ATR unavailable",
      rejectionReason: "cannot score price significance without ATR",
    });
  }

  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  const preferSupport = last.close >= first.close;
  const side = preferSupport ? "low" : "high";
  const direction: TrendlineDirection = preferSupport ? "support" : "resistance";
  const pivots = confirmedPivots(candles, side);
  if (pivots.length < 2) {
    return reject({
      ...base,
      direction,
      reason: "insufficient confirmed pivots",
      rejectionReason: "need at least two confirmed swing pivots",
    });
  }

  // Prefer the two strongest, well-separated recent pivots.
  let best: TrendlineProposal | null = null;
  for (let i = 0; i < pivots.length - 1; i++) {
    for (let j = i + 1; j < pivots.length; j++) {
      const p1 = pivots[i]!;
      const p2 = pivots[j]!;
      const candleSeparation = p2.index - p1.index;
      const timeSeparationMs = p2.candle.time - p1.candle.time;
      const price1 = side === "low" ? p1.candle.low : p1.candle.high;
      const price2 = side === "low" ? p2.candle.low : p2.candle.high;
      const priceDistance = Math.abs(price2 - price1);
      const atrNorm = priceDistance / atr;
      const anchors: TrendlineAnchor[] = [
        {
          time: p1.candle.time,
          price: price1,
          candleIndex: p1.index,
          pivot: side === "low" ? "swing_low" : "swing_high",
        },
        {
          time: p2.candle.time,
          price: price2,
          candleIndex: p2.index,
          pivot: side === "low" ? "swing_low" : "swing_high",
        },
      ];

      if (candleSeparation < MIN_CANDLE_SEPARATION) {
        continue;
      }
      if (candleSeparation < MIN_TIME_BARS) continue;
      if (atrNorm < MIN_ATR_DISTANCE) continue;

      const touches = countTouches(candles, anchors[0]!, anchors[1]!, side, atr);
      const broken = isBroken(candles, anchors[0]!, anchors[1]!, side, atr);
      if (broken) continue;

      const slope = (price2 - price1) / Math.max(1, candleSeparation);
      let score = 40;
      score += Math.min(25, candleSeparation);
      score += Math.min(20, atrNorm * 20);
      score += Math.min(15, (touches - 2) * 5);
      if (score < MIN_EVIDENCE_SCORE) continue;

      const proposal: TrendlineProposal = {
        accepted: true,
        evidence: {
          policyVersion: TRENDLINE_EVIDENCE_POLICY_VERSION,
          direction,
          timeframe: input.timeframe,
          anchors,
          independentTouches: touches,
          candleSeparation,
          timeSeparationMs,
          priceDistance,
          atrNormalizedDistance: atrNorm,
          slope,
          evidenceScore: Math.min(100, Math.round(score)),
          sourceDetector: "confirmed_swing_pivots",
          reason: `${direction} trendline from confirmed pivots (${candleSeparation} bars, ${touches} touches)`,
          broken: false,
        },
      };
      if (!best || proposal.evidence.evidenceScore > best.evidence.evidenceScore) {
        best = proposal;
      }
    }
  }

  if (best) return best;

  return reject({
    ...base,
    direction,
    reason: "no structural trendline met evidence thresholds",
    rejectionReason:
      "anchors must be confirmed pivots with adequate separation and ATR significance",
  });
}
