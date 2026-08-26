/**
 * Recommendation statistics — derived ONLY from tracked recommendation outcomes
 * (never from chat text). Win rate uses completed, triggered recommendations
 * only; pending/untriggered records never inflate it.
 *
 * The R-based KPIs (expectancy, profit factor, equity curve, MFE/MAE means)
 * read the sweep's persisted measurements first and fall back to what a
 * legacy row's own levels honestly allow (realizedROf) — never further.
 */
import { getTradingSessionInfo } from "@/lib/agent/core/tradingSessions";
import {
  exitTimeOf,
  gradeIsLoss,
  gradeIsWin,
  gradeRecommendation,
  realizedROf,
  TERMINAL_GRADES,
  type RecommendationGrade,
} from "./tradeMetrics";
import type { TrackedRecommendation } from "./types";

export type StatsPeriod = "today" | "7d" | "30d" | "all";

export interface GroupStat {
  key: string;
  total: number;
  wins: number;
  losses: number;
  /** 0..100 over completed triggered only; null below the sample-size floor. */
  winRate: number | null;
}

/** One completed trade on the cumulative-R curve. */
export interface EquityCurvePoint {
  id: string;
  at: number;
  grade: RecommendationGrade;
  /** This trade's realized R. */
  r: number;
  /** Running total after this trade. */
  cumR: number;
}

export interface StreakSummary {
  /** The run the record is currently on. */
  current: { kind: "win" | "loss" | "none"; length: number };
  longestWins: number;
  longestLosses: number;
}

/** One row of the recent-outcomes strip, newest first. */
export interface RecentOutcome {
  id: string;
  symbol: string;
  direction: TrackedRecommendation["direction"];
  grade: RecommendationGrade;
  r: number | null;
  at: number;
}

export interface RecommendationStats {
  total: number;
  active: number;
  pending: number;
  wins: number;
  losses: number;
  /** 0..100; null when completedTriggered < WIN_RATE_SAMPLE_FLOOR. */
  winRate: number | null;
  completedTriggered: number;
  /** untriggeredExpired / total — expired-unactivated is not a loss. */
  expiredUnactivatedRate: number | null;
  /**
   * Of the plans that reached a terminal state, how many actually FILLED —
   * the honesty metric for a conditional-plan product (0..1). Null when no
   * plan has resolved yet.
   */
  activationRate: number | null;
  /** Sum of realized R over every terminal trade with a known R. */
  totalRealizedR: number | null;
  /**
   * Mean realized R per completed triggered trade. A quoted rate — suppressed
   * below the same sample floor as the win percentage.
   */
  expectancyR: number | null;
  /** Gross win R / gross loss R; null below the floor or with no losses. */
  profitFactor: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** Means of the sweep's excursion measurements, where recorded. */
  avgMfeR: number | null;
  avgMaeR: number | null;
  avgTimeToActivationMs: number | null;
  avgTimeInTradeMs: number | null;
  /** Cumulative realized R over time — the record as a curve. */
  equityCurve: EquityCurvePoint[];
  /** Terminal grades (tradeMetrics.ts taxonomy), zero-filled. */
  byGrade: { grade: RecommendationGrade; count: number }[];
  /** Trading session of the fill (or issue, when never filled). */
  bySession: GroupStat[];
  streaks: StreakSummary;
  /** Newest-first strip of the latest terminal results. */
  recentOutcomes: RecentOutcome[];
  breakdown: {
    win_tp1: number;
    win_tp2: number;
    win_tp3: number;
    loss: number;
    expired: number;
    cancelled: number;
    invalidated: number;
    untriggeredExpired: number;
  };
  bySymbol: GroupStat[];
  byTimeframe: GroupStat[];
  bySetupType: GroupStat[];
  byDirection: GroupStat[];
  /**
   * platform_agent vs mcp_client, kept apart in computation — a client-authored
   * plan graded into the platform's row (or the reverse) corrupts both records.
   * Rows from before the column read as platform_agent, the only producer that
   * existed then.
   */
  byDecisionSource: GroupStat[];
  scalp: GroupStat;
  avgPlannedRr: number | null;
  avgAchievedRr: number | null;
}

const WIN_OUTCOMES = new Set(["win_tp1", "win_tp2", "win_tp3"]);

/**
 * Below this completed-triggered sample, no win-rate percentage is shown.
 * Matches find_similar_cases (`MIN_STATS_SAMPLE`) so a handful of outcomes
 * never becomes a quoted rate.
 */
export const WIN_RATE_SAMPLE_FLOOR = 8;

function periodStartMs(period: StatsPeriod, now: number): number {
  const DAY = 86_400_000;
  if (period === "today") return now - DAY;
  if (period === "7d") return now - 7 * DAY;
  if (period === "30d") return now - 30 * DAY;
  return 0;
}

export function filterByPeriod(
  recs: TrackedRecommendation[],
  period: StatsPeriod,
  now = Date.now(),
): TrackedRecommendation[] {
  if (period === "all") return recs;
  const start = periodStartMs(period, now);
  return recs.filter((r) => r.createdAt >= start);
}

function isWin(r: TrackedRecommendation): boolean {
  return WIN_OUTCOMES.has(r.outcome);
}
function isLoss(r: TrackedRecommendation): boolean {
  return r.outcome === "loss";
}
/** Completed = triggered AND resolved to a win or a loss. */
function isCompletedTriggered(r: TrackedRecommendation): boolean {
  return Boolean(r.triggeredAt) && (isWin(r) || isLoss(r));
}

function groupStat(key: string, list: TrackedRecommendation[]): GroupStat {
  const completed = list.filter(isCompletedTriggered);
  const wins = completed.filter(isWin).length;
  const losses = completed.filter(isLoss).length;
  const denom = wins + losses;
  return {
    key,
    total: list.length,
    wins,
    losses,
    winRate:
      denom >= WIN_RATE_SAMPLE_FLOOR ? Math.round((wins / denom) * 100) : null,
  };
}

function groupBy(
  recs: TrackedRecommendation[],
  keyOf: (r: TrackedRecommendation) => string | undefined,
): GroupStat[] {
  const map = new Map<string, TrackedRecommendation[]>();
  for (const r of recs) {
    const k = keyOf(r);
    if (!k) continue;
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([k, list]) => groupStat(k, list))
    .sort((a, b) => b.total - a.total);
}

/** Achieved reward:risk from the stored levels for a completed trade. */
function achievedRr(r: TrackedRecommendation): number | null {
  const risk = Math.abs(r.entry - r.stopLoss);
  if (!(risk > 0)) return null;
  if (isLoss(r)) return -1;
  const tpIndex =
    r.outcome === "win_tp3" ? 2 : r.outcome === "win_tp2" ? 1 : r.outcome === "win_tp1" ? 0 : -1;
  const target = tpIndex >= 0 ? r.targets[tpIndex] : undefined;
  if (target == null) return null;
  return Math.abs(target - r.entry) / risk;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * The trading session a record belongs to — the session of its FILL, since
 * that is when the market took the trade; an unfilled plan groups under its
 * issue time. Pure wall-clock arithmetic (tradingSessions.ts); "off_hours"
 * when no major center was open.
 */
function sessionKeyOf(r: TrackedRecommendation): string {
  return getTradingSessionInfo(r.triggeredAt ?? r.createdAt).primary ?? "off_hours";
}

/** Terminal rows ordered by when they actually ended. */
function terminalByExit(recs: TrackedRecommendation[]): TrackedRecommendation[] {
  return recs
    .filter((r) => r.outcome !== "pending")
    .sort((a, b) => exitTimeOf(a) - exitTimeOf(b));
}

function buildEquityCurve(terminal: TrackedRecommendation[]): EquityCurvePoint[] {
  const points: EquityCurvePoint[] = [];
  let cum = 0;
  for (const r of terminal) {
    const realized = realizedROf(r);
    if (realized == null) continue;
    cum = round2(cum + realized);
    points.push({
      id: r.id,
      at: exitTimeOf(r),
      grade: gradeRecommendation(r),
      r: realized,
      cumR: cum,
    });
  }
  return points;
}

function buildStreaks(terminal: TrackedRecommendation[]): StreakSummary {
  let longestWins = 0;
  let longestLosses = 0;
  let run: { kind: "win" | "loss" | "none"; length: number } = { kind: "none", length: 0 };
  for (const r of terminal) {
    const grade = gradeRecommendation(r);
    const kind = gradeIsWin(grade) ? "win" : gradeIsLoss(grade) ? "loss" : null;
    if (!kind) continue; // expiries/invalidation neither extend nor break a streak claim
    run = run.kind === kind ? { kind, length: run.length + 1 } : { kind, length: 1 };
    if (kind === "win") longestWins = Math.max(longestWins, run.length);
    else longestLosses = Math.max(longestLosses, run.length);
  }
  return { current: run, longestWins, longestLosses };
}

export function computeRecommendationStats(
  input: TrackedRecommendation[],
): RecommendationStats {
  const recs = input;
  const completed = recs.filter(isCompletedTriggered);
  const wins = completed.filter(isWin).length;
  const losses = completed.filter(isLoss).length;
  const denom = wins + losses;

  const active = recs.filter(
    (r) => r.outcome === "pending" && Boolean(r.triggeredAt),
  ).length;
  const pending = recs.filter(
    (r) => r.outcome === "pending" && !r.triggeredAt,
  ).length;

  const count = (o: string) => recs.filter((r) => r.outcome === o).length;

  const plannedRrs = recs.map((r) => r.rr).filter((v): v is number => v != null && Number.isFinite(v));
  const achievedRrs = completed
    .map(achievedRr)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const mean = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;

  const untriggeredExpired = recs.filter(
    (r) => r.outcome === "expired" && !r.triggeredAt,
  ).length;

  // ── The R record ───────────────────────────────────────────────────────────
  const terminal = terminalByExit(recs);
  const equityCurve = buildEquityCurve(terminal);
  const realizedRs = terminal
    .map(realizedROf)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const completedRs = completed
    .map(realizedROf)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const winRs = completed
    .filter(isWin)
    .map(realizedROf)
    .filter((v): v is number => v != null && v > 0);
  const lossRs = completed
    .filter(isLoss)
    .map(realizedROf)
    .filter((v): v is number => v != null && v < 0);
  const grossWin = winRs.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(lossRs.reduce((a, b) => a + b, 0));

  const mfeRs = recs
    .map((r) => r.mfeR)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const maeRs = recs
    .map((r) => r.maeR)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const activationTimes = recs
    .filter((r) => r.triggeredAt)
    .map((r) => Math.max(0, (r.triggeredAt ?? 0) - r.createdAt));
  const tradeTimes = recs
    .map((r) => r.timeInTradeMs)
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);

  const gradeCounts = new Map<RecommendationGrade, number>();
  for (const r of terminal) {
    const grade = gradeRecommendation(r);
    gradeCounts.set(grade, (gradeCounts.get(grade) ?? 0) + 1);
  }

  const recentOutcomes: RecentOutcome[] = [...terminal]
    .reverse()
    .slice(0, 12)
    .map((r) => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      grade: gradeRecommendation(r),
      r: realizedROf(r),
      at: exitTimeOf(r),
    }));

  const quotable = denom >= WIN_RATE_SAMPLE_FLOOR;

  return {
    total: recs.length,
    active,
    pending,
    wins,
    losses,
    winRate:
      denom >= WIN_RATE_SAMPLE_FLOOR ? Math.round((wins / denom) * 100) : null,
    completedTriggered: completed.length,
    expiredUnactivatedRate:
      recs.length > 0
        ? Math.round((untriggeredExpired / recs.length) * 1000) / 1000
        : null,
    activationRate:
      terminal.length > 0
        ? Math.round(
            (terminal.filter((r) => r.triggeredAt).length / terminal.length) * 1000,
          ) / 1000
        : null,
    totalRealizedR: realizedRs.length ? round2(realizedRs.reduce((a, b) => a + b, 0)) : null,
    // Quoted rates obey the same sample floor as the win percentage — a
    // handful of outcomes never becomes an advertised edge.
    expectancyR:
      quotable && completedRs.length
        ? round2(completedRs.reduce((a, b) => a + b, 0) / completedRs.length)
        : null,
    profitFactor:
      quotable && grossLoss > 0 ? round2(grossWin / grossLoss) : null,
    avgWinR: winRs.length ? round2(grossWin / winRs.length) : null,
    avgLossR: lossRs.length ? round2(-grossLoss / lossRs.length) : null,
    avgMfeR: mfeRs.length ? round2(mfeRs.reduce((a, b) => a + b, 0) / mfeRs.length) : null,
    avgMaeR: maeRs.length ? round2(maeRs.reduce((a, b) => a + b, 0) / maeRs.length) : null,
    avgTimeToActivationMs: activationTimes.length
      ? Math.round(activationTimes.reduce((a, b) => a + b, 0) / activationTimes.length)
      : null,
    avgTimeInTradeMs: tradeTimes.length
      ? Math.round(tradeTimes.reduce((a, b) => a + b, 0) / tradeTimes.length)
      : null,
    equityCurve,
    byGrade: TERMINAL_GRADES.map((grade) => ({
      grade,
      count: gradeCounts.get(grade) ?? 0,
    })),
    bySession: groupBy(recs, sessionKeyOf),
    streaks: buildStreaks(terminal),
    recentOutcomes,
    breakdown: {
      win_tp1: count("win_tp1"),
      win_tp2: count("win_tp2"),
      win_tp3: count("win_tp3"),
      loss: count("loss"),
      expired: count("expired"),
      cancelled: count("cancelled"),
      invalidated: count("invalidated"),
      untriggeredExpired,
    },
    bySymbol: groupBy(recs, (r) => r.symbol),
    byTimeframe: groupBy(recs, (r) => r.interval),
    bySetupType: groupBy(recs, (r) => r.setupType),
    byDirection: groupBy(recs, (r) => r.direction),
    byDecisionSource: groupBy(recs, (r) => r.decisionSource ?? "platform_agent"),
    scalp: groupStat("scalp", recs.filter((r) => r.setupType === "scalp")),
    avgPlannedRr: mean(plannedRrs),
    avgAchievedRr: mean(achievedRrs),
  };
}
