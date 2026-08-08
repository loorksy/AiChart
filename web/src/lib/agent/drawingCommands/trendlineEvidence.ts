/**
 * Canonical trendline-evidence contract. A structural trendline must not be
 * drawn merely because two nearby candle points can be connected.
 *
 * The geometry itself is delegated to the shared engine
 * (chart/geometry/trendlines.ts `evaluateTrendlineCandidates`), so the chat
 * command and the analysis snapshot accept exactly the same lines:
 *
 *  - envelope rule: no candle between the first anchor and the last candle
 *    may CLOSE through the line by more than 0.25×ATR (wicks tolerated);
 *  - touches are pivots within 0.15×ATR, ≥3 bars apart, ≥2 required — the old
 *    `Math.max(touches, 2)` floor is gone;
 *  - scoring: touches dominant, then span coverage and recency; the steepness
 *    (ATR-distance) reward is gone, so flat lines compete fairly;
 *  - the second anchor must be within the last MAX_ANCHOR_AGE_BARS bars.
 *
 * Direction comes from detected structure (detectSwings → detectTrend), not
 * from a naive first-vs-last close compare: uptrend → support, downtrend →
 * resistance, range/unknown → both sides evaluated and the stronger line wins.
 */
import type { AgentCandle } from "../marketContext/detectors";
import { detectSwings, detectTrend } from "../marketContext/detectors";
import { confirmedPivots } from "@/lib/chart/geometry/pivots";
import { evaluateTrendlineCandidates } from "@/lib/chart/geometry/trendlines";
import type { TrendlineGeometry } from "@/lib/chart/geometry/types";

export const TRENDLINE_EVIDENCE_POLICY_VERSION = "2.0.0";

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

const MIN_CANDLES = 40;

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

  if (candles.length < MIN_CANDLES) {
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

  // Direction from detected structure, not from a full-history close compare.
  const trend = detectTrend(detectSwings(candles));
  const attempts: Array<{ side: "low" | "high"; direction: TrendlineDirection }> =
    trend === "uptrend"
      ? [{ side: "low", direction: "support" }]
      : trend === "downtrend"
        ? [{ side: "high", direction: "resistance" }]
        : [
            { side: "low", direction: "support" },
            { side: "high", direction: "resistance" },
          ];

  let maxPivots = 0;
  let best: { line: TrendlineGeometry; direction: TrendlineDirection } | null =
    null;
  for (const attempt of attempts) {
    const pivots = confirmedPivots(candles, attempt.side);
    maxPivots = Math.max(maxPivots, pivots.length);
    const [top] = evaluateTrendlineCandidates(candles, pivots, attempt.side, atr);
    if (!top) continue;
    // Touches dominant across sides too, then confidence; ties keep support.
    if (
      !best ||
      top.touches > best.line.touches ||
      (top.touches === best.line.touches &&
        top.confidence > best.line.confidence)
    ) {
      best = { line: top, direction: attempt.direction };
    }
  }

  const primaryDirection = attempts[0]!.direction;
  if (maxPivots < 2) {
    return reject({
      ...base,
      direction: primaryDirection,
      reason: "insufficient confirmed pivots",
      rejectionReason: "need at least two confirmed swing pivots",
    });
  }
  if (!best) {
    return reject({
      ...base,
      direction: primaryDirection,
      reason: "no structural trendline met evidence thresholds",
      rejectionReason:
        "anchors must be confirmed pivots with adequate separation, an unviolated close envelope, ≥2 genuine pivot touches, and a recent second anchor",
    });
  }

  const { line, direction } = best;
  const [a, b] = line.anchors;
  const pivotKind = direction === "support" ? "swing_low" : "swing_high";
  const priceDistance = Math.abs(b.price - a.price);
  return {
    accepted: true,
    evidence: {
      policyVersion: TRENDLINE_EVIDENCE_POLICY_VERSION,
      direction,
      timeframe: input.timeframe,
      anchors: [
        { time: a.time, price: a.price, candleIndex: a.index, pivot: pivotKind },
        { time: b.time, price: b.price, candleIndex: b.index, pivot: pivotKind },
      ],
      independentTouches: line.touches,
      candleSeparation: line.candleSeparation,
      timeSeparationMs: b.time - a.time,
      priceDistance,
      // Reported for observability; no longer scored (steepness is not merit).
      atrNormalizedDistance: priceDistance / atr,
      slope: line.slope,
      evidenceScore: line.confidence,
      sourceDetector: "confirmed_swing_pivots",
      reason: `${direction} trendline from confirmed pivots (${line.candleSeparation} bars, ${line.touches} pivot touches, envelope respected)`,
      broken: false,
    },
  };
}
