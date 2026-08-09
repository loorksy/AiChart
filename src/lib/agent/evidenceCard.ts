/**
 * Evidence card and bounded historical contribution (RELIABILITY_PLAN.md
 * item 13): close the gap where the strategy factory's validated backtests
 * never reached the agent's answer — every recommendation showed a bare
 * confidence number and the operator never saw WHY.
 *
 * Two strict rules, both enforced here:
 *
 * 1. **The gates are shown, never loosened.** This module only surfaces
 *    evidence that ALREADY passed the statistical gates (≥100 trades,
 *    walk-forward, an approved deployment). It never grants execution
 *    authority — `requireRecommendationEvidence` remains the sole authority —
 *    and it can never turn an unvalidated setup into a validated one.
 * 2. **Historical influence stays bounded.** The confidence contribution is
 *    clamped to the plan's existing range (−0.15 … +0.10). More history can
 *    never dominate live analysis, and a glowing backtest cannot manufacture
 *    confidence the live read does not support.
 */
// TYPE-only import (erased at build time) — safe from the client bundle.
import type { StrategyBacktestEvidence, StrategyDeployment } from "@/lib/strategies/evidence";
// VALUE import must come from the dependency-free thresholds module: importing
// it from evidence.ts would drag the database into the browser bundle and break
// `next build`. Types are erased; values are not.
import { MIN_BACKTEST_TRADES } from "@/lib/strategies/thresholds";

/** The plan's fixed envelope for historical influence. Do not widen. */
export const HISTORICAL_DELTA_MIN = -0.15;
export const HISTORICAL_DELTA_MAX = 0.1;

export type WalkForwardState = "passed" | "failed" | "not_evaluated";

export interface EvidenceCard {
  strategyId: string;
  symbol: string;
  timeframe: string;
  /** Historical trades behind the evidence (the 100-trade gate is on this). */
  tradeCount: number;
  winRate: number | null;
  profitFactor: number | null;
  /** Server-calibrated confidence with its interval — never a bare number. */
  calibratedConfidence: number | null;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  walkForward: WalkForwardState;
  /** shadow / active / suspended … — a live-looking card must show its state. */
  deploymentState: string | null;
  /** Realised live sample so the operator can compare expectation to reality. */
  liveSampleSize: number;
  liveWinRate: number | null;
  /** True only when this evidence satisfies the execution-grade gates. */
  meetsExecutionGates: boolean;
  /** Why it does not qualify, when it does not. Never a raw internal string. */
  shortfallReason: string | null;
}

/** Read the walk-forward verdict out of a stored validation blob, honestly. */
export function walkForwardStateFrom(validation: Record<string, unknown>): WalkForwardState {
  const raw =
    (validation.walk_forward as Record<string, unknown> | undefined) ??
    (validation.walkForward as Record<string, unknown> | undefined);
  if (!raw) return "not_evaluated";
  const passed = raw.passed ?? raw.pass ?? raw.ok;
  if (passed === true) return "passed";
  if (passed === false) return "failed";
  return "not_evaluated";
}

/**
 * Build the operator-facing evidence card. `deployment` may be absent: a
 * backtest without an approved deployment is still worth SHOWING, but it is
 * explicitly marked as not execution-grade.
 */
export function buildEvidenceCard(input: {
  backtest: StrategyBacktestEvidence;
  deployment?: StrategyDeployment | null;
}): EvidenceCard {
  const { backtest, deployment } = input;
  const walkForward = walkForwardStateFrom(backtest.validation ?? {});

  let shortfallReason: string | null = null;
  if (backtest.tradeCount < MIN_BACKTEST_TRADES) {
    shortfallReason = `historical_trades_below_minimum:${backtest.tradeCount}/${MIN_BACKTEST_TRADES}`;
  } else if (walkForward !== "passed") {
    shortfallReason = `walk_forward_${walkForward}`;
  } else if (!deployment) {
    shortfallReason = "no_approved_deployment";
  } else if (deployment.state === "suspended") {
    shortfallReason = "deployment_suspended";
  }

  return {
    strategyId: backtest.strategyId,
    symbol: backtest.symbol,
    timeframe: backtest.timeframe,
    tradeCount: backtest.tradeCount,
    winRate: backtest.winRate,
    profitFactor: backtest.profitFactor,
    calibratedConfidence: deployment?.calibratedConfidence ?? backtest.calibratedConfidence,
    confidenceLow: deployment?.confidenceLow ?? backtest.confidenceLow,
    confidenceHigh: deployment?.confidenceHigh ?? backtest.confidenceHigh,
    walkForward,
    deploymentState: deployment?.state ?? null,
    liveSampleSize: deployment?.liveSampleSize ?? 0,
    liveWinRate: deployment?.liveWinRate ?? null,
    meetsExecutionGates: shortfallReason === null,
    shortfallReason,
  };
}

/**
 * Bounded confidence contribution from historical evidence.
 *
 * Only execution-grade evidence may move confidence UP, and only within the
 * plan's envelope. Evidence that fails its gates contributes 0 (it is shown,
 * not scored) — except realised live decay, which may pull confidence DOWN:
 * being slower to trust reality-contradicting history is the safe asymmetry.
 */
export function scoreHistoricalEvidence(card: EvidenceCard): {
  delta: number;
  detail: string;
} {
  const clamp = (d: number) =>
    Math.max(HISTORICAL_DELTA_MIN, Math.min(HISTORICAL_DELTA_MAX, d));

  // Live results contradicting the backtest lower confidence regardless of
  // whether the setup is execution-grade.
  let decayPenalty = 0;
  if (
    card.liveSampleSize >= 20 &&
    card.liveWinRate != null &&
    card.winRate != null &&
    card.liveWinRate < card.winRate
  ) {
    const gap = card.winRate - card.liveWinRate;
    decayPenalty = -Math.min(0.15, gap);
  }

  if (!card.meetsExecutionGates) {
    return {
      delta: clamp(decayPenalty),
      detail: decayPenalty < 0
        ? `not_execution_grade(${card.shortfallReason}) live_decay=${decayPenalty.toFixed(3)}`
        : `not_execution_grade(${card.shortfallReason}) delta=0`,
    };
  }

  // Sample-size weight: 100 trades is the floor, not proof of a large sample.
  const n = card.tradeCount;
  const sampleWeight = n >= 400 ? 1 : n >= 200 ? 0.75 : 0.5;

  // Confidence interval width penalises an unstable estimate.
  const width =
    card.confidenceHigh != null && card.confidenceLow != null
      ? Math.max(0, card.confidenceHigh - card.confidenceLow)
      : null;
  const stability = width == null ? 0.5 : width > 30 ? 0.4 : width > 15 ? 0.7 : 1;

  // Edge signal: profit factor above 1 is the only "positive" input, and it is
  // deliberately shallow — history nudges, it never decides.
  const pf = card.profitFactor;
  const edge = pf == null ? 0 : Math.max(0, Math.min(1, (pf - 1) / 1.5));

  const positive = HISTORICAL_DELTA_MAX * edge * sampleWeight * stability;
  const delta = clamp(positive + decayPenalty);
  return {
    delta,
    detail: `n=${n} pf=${pf ?? "na"} weight=${sampleWeight} stability=${stability} live_decay=${decayPenalty.toFixed(3)} delta=${delta.toFixed(3)}`,
  };
}

/** Short, operator-safe summary line for the card (no internal vocabulary). */
export function summarizeEvidenceCard(card: EvidenceCard, locale: "ar" | "en"): string {
  const wf =
    card.walkForward === "passed"
      ? locale === "ar" ? "اجتاز الاختبار الأمامي" : "passed walk-forward"
      : card.walkForward === "failed"
        ? locale === "ar" ? "لم يجتز الاختبار الأمامي" : "failed walk-forward"
        : locale === "ar" ? "لم يُقيَّم أمامياً" : "walk-forward not evaluated";
  if (locale === "ar") {
    return `${card.tradeCount} صفقة تاريخية · ${wf}${
      card.liveSampleSize > 0 ? ` · ${card.liveSampleSize} نتيجة حية` : ""
    }`;
  }
  return `${card.tradeCount} historical trades · ${wf}${
    card.liveSampleSize > 0 ? ` · ${card.liveSampleSize} live results` : ""
  }`;
}
