/**
 * Strategy decay lifecycle (RELIABILITY_PLAN.md item 19, first part).
 *
 * Today a deployment is binary: fine, or suspended. That is too blunt in both
 * directions — it suspends on a run of bad luck, and it keeps a slowly-rotting
 * edge fully live until it crosses one hard line. This models the real path:
 *
 *   active → monitoring → decayed → disabled
 *
 * with hysteresis (recovery must be demonstrated, not merely one good trade)
 * and a minimum sample before any downgrade, so noise cannot demote a healthy
 * strategy. Decay is measured on the metrics that actually matter live: win
 * rate, profit factor, and realised Sharpe — not win rate alone.
 *
 * Pure policy: it decides a LABEL. It never executes, never edits a
 * recommendation, and never loosens a statistical gate — a decayed or disabled
 * strategy simply stops being usable evidence for execution.
 */

export type LifecycleState = "active" | "monitoring" | "decayed" | "disabled";

export interface LivePerformance {
  /** Realised live trades observed for this deployment. */
  sampleSize: number;
  winRate: number | null;
  profitFactor: number | null;
  sharpeRatio: number | null;
}

export interface ExpectedPerformance {
  winRate: number | null;
  profitFactor: number | null;
}

export interface DecayThresholds {
  /** Below this sample nothing is downgraded — noise is not decay. */
  minSampleForJudgement: number;
  /** Relative win-rate shortfall that starts monitoring (0.15 = 15% worse). */
  monitorWinRateDrop: number;
  /** Relative shortfall that marks the edge decayed. */
  decayedWinRateDrop: number;
  /** Profit factor at/below which the edge is gone regardless of win rate. */
  disabledProfitFactor: number;
  /** Consecutive healthy evaluations required to climb back up. */
  recoveryStreak: number;
}

export const DEFAULT_DECAY_THRESHOLDS: DecayThresholds = {
  minSampleForJudgement: 20,
  monitorWinRateDrop: 0.15,
  decayedWinRateDrop: 0.3,
  disabledProfitFactor: 1,
  recoveryStreak: 2,
};

export interface LifecycleEvaluation {
  state: LifecycleState;
  /** Operator-facing reason. Never internal vocabulary. */
  reason: string;
  /** May this deployment still back an execution-grade recommendation? */
  usableAsExecutionEvidence: boolean;
  /** Healthy evaluations in a row (drives hysteresis on the way back up). */
  healthyStreak: number;
}

const ORDER: Record<LifecycleState, number> = {
  active: 0,
  monitoring: 1,
  decayed: 2,
  disabled: 3,
};

/**
 * Evaluate the next lifecycle state.
 *
 * Asymmetric by design: a downgrade takes effect immediately (protecting the
 * account), while an upgrade requires `recoveryStreak` consecutive healthy
 * evaluations (so one lucky trade cannot re-promote a broken strategy).
 */
export function evaluateLifecycle(input: {
  current: LifecycleState;
  live: LivePerformance;
  expected: ExpectedPerformance;
  /** Healthy evaluations already accumulated (carry from the previous run). */
  healthyStreak?: number;
  thresholds?: Partial<DecayThresholds>;
}): LifecycleEvaluation {
  const t = { ...DEFAULT_DECAY_THRESHOLDS, ...(input.thresholds ?? {}) };
  const { current, live, expected } = input;
  const priorStreak = Math.max(0, input.healthyStreak ?? 0);

  const settle = (state: LifecycleState, reason: string, healthyStreak: number) => ({
    state,
    reason,
    usableAsExecutionEvidence: state === "active" || state === "monitoring",
    healthyStreak,
  });

  // Disabled is terminal until an operator intervenes — never auto-revived.
  if (current === "disabled") {
    return settle("disabled", "الاستراتيجية موقوفة وتحتاج مراجعة يدوية.", 0);
  }

  if (live.sampleSize < t.minSampleForJudgement) {
    return settle(
      current,
      `العينة الحية غير كافية للحكم (${live.sampleSize}/${t.minSampleForJudgement}).`,
      priorStreak,
    );
  }

  // A collapsed profit factor means the edge is gone, whatever the win rate.
  if (live.profitFactor != null && live.profitFactor <= t.disabledProfitFactor) {
    return settle(
      "disabled",
      "عامل الربح الحي لم يعد فوق نقطة التعادل — أُوقفت الاستراتيجية.",
      0,
    );
  }

  const drop =
    expected.winRate != null && expected.winRate > 0 && live.winRate != null
      ? (expected.winRate - live.winRate) / expected.winRate
      : 0;

  let target: LifecycleState;
  let reason: string;
  if (drop >= t.decayedWinRateDrop) {
    target = "decayed";
    reason = "الأداء الحي أضعف بوضوح من المتوقع — لم تعد صالحة كدليل تنفيذي.";
  } else if (drop >= t.monitorWinRateDrop || (live.sharpeRatio != null && live.sharpeRatio < 0)) {
    target = "monitoring";
    reason = "الأداء الحي أقل من المتوقع — تحت المراقبة.";
  } else {
    target = "active";
    reason = "الأداء الحي متسق مع المتوقع.";
  }

  // Downgrade immediately.
  if (ORDER[target] > ORDER[current]) {
    return settle(target, reason, 0);
  }
  // Same level: healthy readings accumulate, unhealthy ones reset.
  if (ORDER[target] === ORDER[current]) {
    const streak = target === "active" ? priorStreak : priorStreak + (drop < t.monitorWinRateDrop ? 1 : 0);
    return settle(current, reason, streak);
  }
  // Upgrade only after a demonstrated recovery streak.
  const streak = priorStreak + 1;
  if (streak < t.recoveryStreak) {
    return settle(
      current,
      `الأداء تحسّن (${streak}/${t.recoveryStreak} تقييمات متتالية مطلوبة للترقية).`,
      streak,
    );
  }
  return settle(target, "تعافى الأداء الحي عبر تقييمات متتالية.", 0);
}
