/**
 * Per-timeframe risk policy. AiChart is a SCALPING product, and a scalp trade
 * is not a slow trade in miniature: it lives or dies on execution cost.
 *
 * The single shared policy (1.5×ATR stop, 1.5R/2.5R targets, 18-bar hold) was
 * written for 1h–4h structure. Applied to 1m/5m it is wrong in both
 * directions: the stop is far too wide relative to a scalp's intent, and an
 * 18-bar hold on 1m is 18 minutes — an eternity for a 5–10 pip idea.
 *
 * Scalp frames therefore get:
 *  - tighter ATR stops (structure is smaller, so the stop must be too);
 *  - a FIRST target that clears the round-trip cost by a real margin, because
 *    spread+slippage on a 6-pip target is the whole trade (see
 *    `minimumViableTargetR`);
 *  - short maximum holding so a dead idea frees the single position slot;
 *  - break-even earlier, and a higher daily trade limit to match frequency.
 */
import type { ResearchTimeframe } from "@/lib/research";
import type { StrategyCostProfile } from "./catalog";

export type TradingStyle = "scalp" | "intraday" | "swing";

export function styleForTimeframe(timeframe: ResearchTimeframe): TradingStyle {
  if (timeframe === "1m" || timeframe === "5m") return "scalp";
  if (timeframe === "15m" || timeframe === "30m") return "intraday";
  return "swing";
}

export interface TimeframeRiskPolicy {
  style: TradingStyle;
  stopAtrMultiple: number;
  /** [first, second] R multiples, 50/50 sizing. */
  targetR: [number, number];
  maximumHoldingBars: number;
  breakEvenAtR: number;
  cooldownBars: number;
  dailyTradeLimit: number;
}

const POLICY: Record<TradingStyle, TimeframeRiskPolicy> = {
  scalp: {
    style: "scalp",
    // Tight structural stop — a scalp invalidates fast or it was never a scalp.
    stopAtrMultiple: 0.8,
    targetR: [1.2, 2.0],
    // 1m: 12 minutes. 5m: an hour. Past that the edge has decayed.
    maximumHoldingBars: 12,
    breakEvenAtR: 0.8,
    cooldownBars: 1,
    dailyTradeLimit: 80,
  },
  intraday: {
    style: "intraday",
    stopAtrMultiple: 1.2,
    targetR: [1.5, 2.5],
    maximumHoldingBars: 18,
    breakEvenAtR: 1,
    cooldownBars: 2,
    dailyTradeLimit: 40,
  },
  swing: {
    style: "swing",
    stopAtrMultiple: 1.5,
    targetR: [1.5, 2.5],
    maximumHoldingBars: 24,
    breakEvenAtR: 1,
    cooldownBars: 2,
    dailyTradeLimit: 30,
  },
};

export function riskPolicyFor(timeframe: ResearchTimeframe): TimeframeRiskPolicy {
  return POLICY[styleForTimeframe(timeframe)];
}

/**
 * Round-trip execution cost in pips: spread is paid on entry AND exit in the
 * engine's worst-case intrabar model, slippage likewise, and commission is
 * charged per lot per side.
 */
export function roundTripCostPips(
  costs: StrategyCostProfile,
  pipValuePerLotUsd = 1,
): number {
  const commissionPips =
    pipValuePerLotUsd > 0
      ? (costs.commissionPerLotSideUsd * 2) / pipValuePerLotUsd
      : 0;
  return (
    Math.max(0, costs.spreadPips) * 2 +
    Math.max(0, costs.slippagePips) * 2 +
    Math.max(0, commissionPips)
  );
}

/**
 * Cost-viability guard for scalping.
 *
 * A target is only meaningful if the gross move clears the round trip by a
 * margin. With an ATR-based stop, the first target's distance in pips is
 * `stopAtrMultiple × ATR × targetR`; we cannot know ATR at spec-build time, so
 * this expresses the requirement as the minimum ratio of target distance to
 * round-trip cost that the backtest must clear to be worth running at all.
 *
 * A strategy whose first target does not clear `MIN_COST_MULTIPLE` × round-trip
 * cost is not "slightly worse" — it is structurally unprofitable, and letting
 * it consume pipeline capacity is waste.
 */
export const MIN_COST_MULTIPLE = 3;

export interface CostViability {
  viable: boolean;
  roundTripPips: number;
  /** Minimum first-target distance (pips) for the trade to be worth taking. */
  requiredTargetPips: number;
  reason: string;
}

/**
 * `atrPips` is the observed ATR of the sample in pips. When unknown the caller
 * should skip the check rather than guess — a wrong guess would silently drop
 * viable strategies.
 */
export function assessCostViability(
  timeframe: ResearchTimeframe,
  costs: StrategyCostProfile,
  atrPips: number,
): CostViability {
  const policy = riskPolicyFor(timeframe);
  const roundTripPips = roundTripCostPips(costs);
  const requiredTargetPips = roundTripPips * MIN_COST_MULTIPLE;
  const firstTargetPips = atrPips * policy.stopAtrMultiple * policy.targetR[0];
  const viable = firstTargetPips >= requiredTargetPips;
  return {
    viable,
    roundTripPips: Number(roundTripPips.toFixed(2)),
    requiredTargetPips: Number(requiredTargetPips.toFixed(2)),
    reason: viable
      ? `first target ≈ ${firstTargetPips.toFixed(1)} pips clears the ${roundTripPips.toFixed(1)}-pip round trip`
      : `first target ≈ ${firstTargetPips.toFixed(1)} pips does not clear ${MIN_COST_MULTIPLE}× the ${roundTripPips.toFixed(1)}-pip round trip`,
  };
}
