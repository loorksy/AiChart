/**
 * Statistical support, ready before the question is asked
 * (docs/UNIFIED_AGENT_PLAN.md §11).
 *
 * The factory produced validated strategies for years and the agent's answers
 * never mentioned them. Not a gate problem — a latency one: evidence was
 * assembled during the request, the assembly could not finish inside the budget,
 * and every analysis recorded "justified but no completed job in latency
 * budget". Strong evidence that arrives after the decision is the same as none.
 *
 * So the lookup is precomputed. Deployments already carry everything needed —
 * calibrated confidence, its interval, live sample size, state — and this reads
 * them per symbol and timeframe so the decision bundle can carry a real grade
 * instead of an apology.
 *
 * It reports strength; it never decides. A recommendation with no matching
 * strategy is labelled "unavailable" and goes out exactly the same.
 */
import { query, queryOne } from "@/lib/db";
import { canonicalStrategySymbol } from "./matchingKeys";

export type SupportLevel = "strong" | "moderate" | "weak" | "unavailable";

export interface StatisticalSupport {
  level: SupportLevel;
  /** Operator-facing sentence — always says what is missing when it is. */
  detail: string;
  strategyId?: string;
  calibratedConfidence?: number;
  confidenceInterval?: [number, number];
  deploymentState?: string;
  liveSampleSize?: number;
}

interface DeploymentRow {
  strategy_id: string;
  state: string;
  calibrated_confidence: number;
  confidence_low: number;
  confidence_high: number;
  live_sample_size: number;
  suspended_reason: string | null;
  updated_at: number;
}

const UNAVAILABLE: StatisticalSupport = {
  level: "unavailable",
  detail: "لا توجد استراتيجية مُحقّقة مطابقة لهذا الرمز والفريم — القرار مبني على التحليل المباشر.",
};

/**
 * The best verified support for a symbol and timeframe.
 *
 * "Best" means the strongest deployment state, then the tightest confidence
 * interval — a wide interval on a small sample is weak evidence however high
 * its midpoint sits.
 */
export async function getStatisticalSupport(input: {
  userId?: number;
  symbol: string;
  timeframe: string;
}): Promise<StatisticalSupport> {
  if (input.userId == null) return UNAVAILABLE;

  const rows = await query<DeploymentRow>(
    `SELECT strategy_id, state, calibrated_confidence, confidence_low, confidence_high,
            live_sample_size, suspended_reason, updated_at
       FROM strategy_deployments
      WHERE user_id = ? AND symbol = ? AND timeframe = ?
      ORDER BY updated_at DESC`,
    [input.userId, canonicalStrategySymbol(input.symbol), input.timeframe],
  ).catch(() => []);

  if (!rows.length) return UNAVAILABLE;

  const usable = rows.filter((row) => row.state !== "suspended");
  if (!usable.length) {
    const suspended = rows[0]!;
    return {
      level: "weak",
      detail: `الاستراتيجية المطابقة مُعلّقة: ${suspended.suspended_reason ?? "تراجع الأداء الحي"} — لا يُعتمد عليها كدعم.`,
      strategyId: suspended.strategy_id,
      deploymentState: suspended.state,
    };
  }

  const best = usable.sort((a, b) => {
    const stateRank = (state: string) => (state === "active" ? 2 : state === "shadow" ? 1 : 0);
    const byState = stateRank(b.state) - stateRank(a.state);
    if (byState !== 0) return byState;
    const widthA = a.confidence_high - a.confidence_low;
    const widthB = b.confidence_high - b.confidence_low;
    return widthA - widthB;
  })[0]!;

  const width = best.confidence_high - best.confidence_low;
  const level: SupportLevel =
    best.state === "active" && width <= 20
      ? "strong"
      : best.state === "active" || width <= 30
        ? "moderate"
        : "weak";

  return {
    level,
    detail:
      `استراتيجية ${best.strategy_id} (${best.state === "active" ? "مفعّلة" : "قيد التتبع"}): ` +
      `ثقة ${best.calibrated_confidence.toFixed(1)}% ` +
      `[${best.confidence_low.toFixed(1)}–${best.confidence_high.toFixed(1)}]` +
      (best.live_sample_size > 0 ? `، ${best.live_sample_size} نتيجة حية.` : "."),
    strategyId: best.strategy_id,
    calibratedConfidence: best.calibrated_confidence,
    confidenceInterval: [best.confidence_low, best.confidence_high],
    deploymentState: best.state,
    liveSampleSize: best.live_sample_size,
  };
}

/** How many validated deployments this operator has, for diagnostics. */
export async function countDeployments(userId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*) AS count FROM strategy_deployments WHERE user_id = ?",
    [userId],
  ).catch(() => null);
  return Number(row?.count ?? 0);
}
