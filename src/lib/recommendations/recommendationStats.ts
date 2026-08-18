/**
 * Recommendation statistics — derived ONLY from tracked recommendation outcomes
 * (never from chat text). Win rate uses completed, triggered recommendations
 * only; pending/untriggered records never inflate it.
 */
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
    scalp: groupStat("scalp", recs.filter((r) => r.setupType === "scalp")),
    avgPlannedRr: mean(plannedRrs),
    avgAchievedRr: mean(achievedRrs),
  };
}
