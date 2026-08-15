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
import { buildEvidenceCard, type EvidenceCard } from "@/lib/agent/evidenceCard";
import type { StrategyDeploymentState } from "./evidence";
import { canonicalStrategySymbol, canonicalStrategyTimeframe } from "./matchingKeys";

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
  /**
   * The matching deployments themselves (top few), so the decision model sees
   * its arsenal — which validated strategies fit this symbol/timeframe and
   * how well — instead of a single opaque grade.
   */
  deployments?: Array<{
    strategyId: string;
    state: string;
    calibratedConfidence: number;
    confidenceInterval: [number, number];
    liveSampleSize: number;
    /** Completed BACKTESTED trades behind the calibration. */
    backtestTrades: number;
    /** 0..1 over those trades, or null when the backtest recorded none. */
    backtestWinRate: number | null;
  }>;
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
  /** From the backtest the deployment was minted from — see the join below. */
  backtest_trades: number | null;
  backtest_win_rate: number | null;
}

/**
 * Deployments carry calibration; the BACKTEST behind them carries the evidence
 * that calibration was computed from.
 *
 * Reading deployments alone gave every caller `live_sample_size`, which is the
 * count of LIVE outcomes observed since deployment — zero for a strategy that
 * has just been minted, and zero for every strategy on an install whose
 * recommendations are still being graded. So the evidence gate (G5) saw a
 * sample size of 0 for a strategy validated on hundreds of backtested trades
 * and could never grade anything "calibrated". The join is what makes the
 * factory's work visible to the gate that exists to weigh it.
 */
const DEPLOYMENT_COLUMNS = `d.strategy_id, d.state, d.calibrated_confidence,
                  d.confidence_low, d.confidence_high, d.live_sample_size,
                  d.suspended_reason, d.updated_at,
                  b.trade_count AS backtest_trades, b.win_rate AS backtest_win_rate`;

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
  const symbol = canonicalStrategySymbol(input.symbol);
  // Canonicalize here, not just at the call site: a caller passing "M15"/"15"
  // silently read "unavailable" forever — the exact class of mismatch
  // matchingKeys exists to prevent.
  const timeframe = canonicalStrategyTimeframe(input.timeframe) ?? input.timeframe;

  let rows: DeploymentRow[] =
    input.userId == null
      ? []
      : await query<DeploymentRow>(
          `SELECT ${DEPLOYMENT_COLUMNS}
             FROM strategy_deployments d
             LEFT JOIN strategy_backtests b ON b.id = d.backtest_id
            WHERE d.user_id = ? AND d.symbol = ? AND d.timeframe = ?
            ORDER BY d.updated_at DESC`,
          [input.userId, symbol, timeframe],
        ).catch(() => []);

  // Platform fallback: the backtest pipeline runs under ONE configured user
  // (STRATEGY_PIPELINE_USER_ID) and writes per-user rows, so every other
  // operator read "unavailable" forever despite the factory's evidence.
  // Validated strategy statistics are platform evidence, not personal data —
  // fall back to the newest rows regardless of owner and say so.
  let shared = false;
  if (!rows.length) {
    rows = await query<DeploymentRow>(
      `SELECT ${DEPLOYMENT_COLUMNS}
         FROM strategy_deployments d
         LEFT JOIN strategy_backtests b ON b.id = d.backtest_id
        WHERE d.symbol = ? AND d.timeframe = ?
        ORDER BY d.updated_at DESC`,
      [symbol, timeframe],
    ).catch(() => []);
    shared = rows.length > 0;
  }

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
      (best.live_sample_size > 0 ? `، ${best.live_sample_size} نتيجة حية` : "") +
      (shared ? "، من سجل التحقق المشترك للمنصة." : "."),
    strategyId: best.strategy_id,
    calibratedConfidence: best.calibrated_confidence,
    confidenceInterval: [best.confidence_low, best.confidence_high],
    deploymentState: best.state,
    liveSampleSize: best.live_sample_size,
    deployments: usable.slice(0, 4).map((row) => ({
      strategyId: row.strategy_id,
      state: row.state,
      calibratedConfidence: row.calibrated_confidence,
      confidenceInterval: [row.confidence_low, row.confidence_high],
      liveSampleSize: row.live_sample_size,
      backtestTrades: Number(row.backtest_trades ?? 0),
      backtestWinRate:
        row.backtest_win_rate == null ? null : Number(row.backtest_win_rate),
    })),
  };
}

/**
 * The evidence card behind the answer.
 *
 * `AgentResult.evidenceCard` has been declared in the types and RENDERED by
 * `SmartChartAgentPanel` for as long as both have existed, and `buildEvidenceCard`
 * had no caller anywhere outside its own test — so the field was never assigned
 * and the card could never appear. The operator saw a confidence number and the
 * factory's validated history stayed invisible, which is the exact failure
 * `evidenceCard.ts` was written to fix.
 *
 * This is the missing lookup. It reads the same deployments `getStatisticalSupport`
 * grades, plus the two backtest columns the card needs that the grade does not:
 * the profit factor and the validation blob holding the walk-forward verdict.
 *
 * Returns null rather than an empty card when nothing matches — a card that
 * renders zeros looks like a strategy that lost, not like one that was never
 * found.
 */
export async function getEvidenceCard(input: {
  userId?: number;
  symbol: string;
  timeframe: string;
}): Promise<EvidenceCard | null> {
  const symbol = canonicalStrategySymbol(input.symbol);
  const timeframe = canonicalStrategyTimeframe(input.timeframe) ?? input.timeframe;

  // An INNER join, unlike the grade's LEFT join: a card with no backtest behind
  // it has no trade count, no walk-forward verdict and no profit factor — that
  // is not evidence, it is a heading.
  const columns = `d.strategy_id, d.state, d.calibrated_confidence, d.confidence_low,
                   d.confidence_high, d.live_sample_size, d.live_win_rate, d.updated_at,
                   b.trade_count, b.win_rate, b.profit_factor, b.validation_json`;
  const where = `d.symbol = ? AND d.timeframe = ? AND d.state != 'suspended'`;

  interface CardRow {
    strategy_id: string;
    state: string;
    calibrated_confidence: number;
    confidence_low: number;
    confidence_high: number;
    live_sample_size: number;
    live_win_rate: number | null;
    trade_count: number | null;
    win_rate: number | null;
    profit_factor: number | null;
    validation_json: string | null;
  }

  // Same two-step as the grade, and for the same reason: the pipeline writes
  // per-user rows under one configured user, so scoping to the asker alone
  // showed every other operator nothing.
  let rows: CardRow[] =
    input.userId == null
      ? []
      : await query<CardRow>(
          `SELECT ${columns} FROM strategy_deployments d
             JOIN strategy_backtests b ON b.id = d.backtest_id
            WHERE d.user_id = ? AND ${where}
            ORDER BY d.updated_at DESC`,
          [input.userId, symbol, timeframe],
        ).catch(() => []);
  if (!rows.length) {
    rows = await query<CardRow>(
      `SELECT ${columns} FROM strategy_deployments d
         JOIN strategy_backtests b ON b.id = d.backtest_id
        WHERE ${where}
        ORDER BY d.updated_at DESC`,
      [symbol, timeframe],
    ).catch(() => []);
  }
  if (!rows.length) return null;

  // "Best" by the same ordering the grade uses — active over shadow, then the
  // tightest interval — so the card and the grade can never describe two
  // different strategies in one answer.
  const best = rows.sort((a, b) => {
    const rank = (state: string) => (state === "active" ? 2 : state === "shadow" ? 1 : 0);
    const byState = rank(b.state) - rank(a.state);
    if (byState !== 0) return byState;
    return (a.confidence_high - a.confidence_low) - (b.confidence_high - b.confidence_low);
  })[0]!;

  let validation: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(best.validation_json ?? "{}") as unknown;
    if (parsed && typeof parsed === "object") validation = parsed as Record<string, unknown>;
  } catch {
    // Unparseable validation is "not evaluated", never "passed": the walk-forward
    // verdict is one of the gates the card exists to SHOW, and defaulting it
    // open would let a corrupt blob read as execution-grade.
    validation = {};
  }

  return buildEvidenceCard({
    backtest: {
      strategyId: best.strategy_id,
      symbol,
      timeframe,
      tradeCount: Number(best.trade_count ?? 0),
      winRate: best.win_rate == null ? null : Number(best.win_rate),
      profitFactor: best.profit_factor == null ? null : Number(best.profit_factor),
      calibratedConfidence: best.calibrated_confidence,
      confidenceLow: best.confidence_low,
      confidenceHigh: best.confidence_high,
      validation,
    },
    deployment: {
      state: best.state as StrategyDeploymentState,
      calibratedConfidence: best.calibrated_confidence,
      confidenceLow: best.confidence_low,
      confidenceHigh: best.confidence_high,
      liveSampleSize: Number(best.live_sample_size ?? 0),
      liveWinRate: best.live_win_rate == null ? null : Number(best.live_win_rate),
    },
  });
}

/** How many validated deployments this operator has, for diagnostics. */
export async function countDeployments(userId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*) AS count FROM strategy_deployments WHERE user_id = ?",
    [userId],
  ).catch(() => null);
  return Number(row?.count ?? 0);
}
