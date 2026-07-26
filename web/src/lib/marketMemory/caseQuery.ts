/**
 * "When has the market looked like this before, and what happened next?"
 * (docs/UNIFIED_AGENT_PLAN.md §10).
 *
 * The query narrows on cheap SQL first — same instrument, same timeframe, same
 * regime family — then ranks the survivors by weighted fingerprint similarity
 * in memory. Doing the ranking in SQL would mean encoding the weights in the
 * schema; keeping it here means the similarity definition lives in exactly one
 * place, next to the fingerprint it compares.
 *
 * What comes back is evidence, and it says how much of it there is. Below the
 * minimum sample the counts are reported with null rates, and a query that
 * finds nothing returns nothing — never a percentage assembled from three
 * cases, because that is precisely the number a decision would lean on hardest
 * and deserve least.
 */
import { query } from "@/lib/db";
import { warehouseKey } from "@/lib/candles/candleRepository";
import {
  fingerprintSimilarity,
  type CaseFingerprint,
  type Regime,
  type Trend,
  type RangeZone,
  type Session,
} from "./caseFingerprint";
import {
  MIN_STATS_SAMPLE,
  summarizeOutcomes,
  type CaseResolution,
  type ForwardOutcome,
  type OutcomeStats,
} from "./forwardOutcome";
import { INDEXER_VERSION } from "./caseIndexer";

export interface SimilarCase {
  caseTime: number;
  direction: "buy" | "sell";
  similarity: number;
  fingerprint: CaseFingerprint;
  patternName: string | null;
  patternStage: string | null;
  outcome: ForwardOutcome;
}

export interface SimilarCaseResult {
  /** Cases above the similarity threshold, closest first. */
  cases: SimilarCase[];
  stats: OutcomeStats;
  /** How many candidates were considered before ranking. */
  candidatesConsidered: number;
  /** True when the sample supports reporting rates rather than bare counts. */
  statisticallyUsable: boolean;
  /** Same-pattern subset, when the live analysis found a named structure. */
  samePattern: { count: number; stats: OutcomeStats } | null;
}

/** Below this the moments are different enough that averaging them misleads. */
const DEFAULT_MIN_SIMILARITY = 0.82;
const DEFAULT_LIMIT = 60;
/** SQL prefilter cap. Ranking 4k rows in memory is microseconds; reading more is wasteful. */
const CANDIDATE_CAP = 4_000;

interface CaseRow {
  case_time: number | string;
  direction: string;
  regime: string;
  trend: string;
  range_zone: string;
  pullback_depth: number | string;
  impulse_atr: number | string;
  volatility: number | string;
  session: string;
  structure_run: number | string;
  pattern_name: string | null;
  pattern_stage: string | null;
  outcome: string;
  outcome_bars: number | string;
  max_favourable: number | string;
  max_adverse: number | string;
  net_r: number | string;
}

function rowFingerprint(row: CaseRow): CaseFingerprint {
  return {
    regime: row.regime as Regime,
    trend: row.trend as Trend,
    rangeZone: row.range_zone as RangeZone,
    pullbackDepth: Number(row.pullback_depth),
    impulseAtr: Number(row.impulse_atr),
    volatility: Number(row.volatility),
    session: row.session as Session,
    structureRun: Number(row.structure_run),
  };
}

function rowOutcome(row: CaseRow): ForwardOutcome {
  return {
    resolution: row.outcome as CaseResolution,
    bars: Number(row.outcome_bars),
    maxFavourableAtr: Number(row.max_favourable),
    maxAdverseAtr: Number(row.max_adverse),
    netR: Number(row.net_r),
  };
}

/**
 * Find historical moments resembling the one described by `fingerprint`.
 *
 * Only resolved cases are returned: an unresolved one has no answer to the
 * question being asked, and counting it as neither win nor loss would quietly
 * dilute every rate computed from the set.
 */
export async function findSimilarCases(input: {
  symbol: string;
  interval: string;
  fingerprint: CaseFingerprint;
  direction: "buy" | "sell";
  /** Restrict to cases carrying this pattern, for the same-structure subset. */
  patternName?: string | null;
  minSimilarity?: number;
  limit?: number;
  /** Exclude cases at or after this time — used when replaying history. */
  beforeMs?: number;
}): Promise<SimilarCaseResult> {
  const key = warehouseKey(input.symbol, input.interval);
  const minSimilarity = input.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 500));

  const conditions = [
    "symbol = ?",
    "interval = ?",
    "indexer_version = ?",
    "direction = ?",
    "outcome IS NOT NULL",
  ];
  const args: unknown[] = [key.symbol, key.interval, INDEXER_VERSION, input.direction];
  // Trend is the heaviest feature in the similarity weights, so filtering on it
  // in SQL removes the bulk of the rows that could never clear the threshold.
  conditions.push("trend = ?");
  args.push(input.fingerprint.trend);
  if (input.beforeMs != null) {
    conditions.push("case_time < ?");
    args.push(Math.floor(input.beforeMs));
  }
  args.push(CANDIDATE_CAP);

  const rows = await query<CaseRow>(
    `SELECT case_time, direction, regime, trend, range_zone, pullback_depth,
            impulse_atr, volatility, session, structure_run,
            pattern_name, pattern_stage,
            outcome, outcome_bars, max_favourable, max_adverse, net_r
       FROM market_cases
      WHERE ${conditions.join(" AND ")}
      ORDER BY case_time DESC
      LIMIT ?`,
    args,
  ).catch(() => []);

  const ranked: SimilarCase[] = [];
  for (const row of rows) {
    const fingerprint = rowFingerprint(row);
    const similarity = fingerprintSimilarity(input.fingerprint, fingerprint);
    if (similarity < minSimilarity) continue;
    ranked.push({
      caseTime: Number(row.case_time),
      direction: row.direction === "sell" ? "sell" : "buy",
      similarity: Number(similarity.toFixed(4)),
      fingerprint,
      patternName: row.pattern_name,
      patternStage: row.pattern_stage,
      outcome: rowOutcome(row),
    });
  }

  // Ties broken by recency: the more recent of two equally similar moments came
  // from a market closer to today's.
  ranked.sort((a, b) => b.similarity - a.similarity || b.caseTime - a.caseTime);
  const cases = ranked.slice(0, limit);
  const stats = summarizeOutcomes(cases.map((entry) => entry.outcome));

  let samePattern: SimilarCaseResult["samePattern"] = null;
  if (input.patternName) {
    const subset = cases.filter((entry) => entry.patternName === input.patternName);
    if (subset.length > 0) {
      samePattern = {
        count: subset.length,
        stats: summarizeOutcomes(subset.map((entry) => entry.outcome)),
      };
    }
  }

  return {
    cases,
    stats,
    candidatesConsidered: rows.length,
    statisticallyUsable: cases.length >= MIN_STATS_SAMPLE,
    samePattern,
  };
}

/**
 * One operator-facing sentence, or null when there is nothing honest to say.
 *
 * The wording distinguishes "no comparable history" from "history that leans
 * against this", because the two mean opposite things to a decision and reading
 * the first as the second is how a good setup gets talked out of.
 */
export function describeSimilarCases(result: SimilarCaseResult): string | null {
  if (!result.cases.length) return null;
  const { sampleSize, hitRate, averageNetR, targetFirst, stopFirst } = result.stats;
  if (hitRate == null) {
    return `${sampleSize} حالة تاريخية مشابهة فقط (${targetFirst} وصلت الهدف، ${stopFirst} ضربت الوقف) — عينة أصغر من أن تُبنى عليها نسبة.`;
  }
  const pct = Math.round(hitRate * 100);
  const net = averageNetR == null ? "" : ` بمتوسط صافي ${averageNetR.toFixed(2)}R`;
  return `${sampleSize} حالة مشابهة: وصل الهدف قبل الوقف في ${pct}%${net}.`;
}

/** Shape the evidence card expects, so a missing memory reports as missing. */
export function caseEvidenceSummary(
  result: SimilarCaseResult | null,
): { count: number; winRate: number | null } | null {
  if (!result || !result.cases.length) return null;
  return { count: result.stats.sampleSize, winRate: result.stats.hitRate };
}

export interface DirectionalCaseEvidence {
  sampleSize: number;
  hitRate: number | null;
  averageNetR: number | null;
  averageBars: number | null;
  samePattern: { count: number; hitRate: number | null } | null;
  summary: string | null;
}

export interface HistoricalCaseEvidence {
  /** How the moment was described, so the reader can judge the match itself. */
  fingerprint: CaseFingerprint;
  long: DirectionalCaseEvidence;
  short: DirectionalCaseEvidence;
  note: string;
}

function directional(result: SimilarCaseResult): DirectionalCaseEvidence {
  return {
    sampleSize: result.stats.sampleSize,
    hitRate: result.stats.hitRate,
    averageNetR: result.stats.averageNetR,
    averageBars: result.stats.averageBars,
    samePattern: result.samePattern
      ? { count: result.samePattern.count, hitRate: result.samePattern.stats.hitRate }
      : null,
    summary: describeSimilarCases(result),
  };
}

/**
 * Both directions, fetched before the direction is chosen.
 *
 * Querying one side would mean the memory is consulted after a direction is
 * already in mind, which turns evidence into justification. Long and short come
 * back together and the brain weighs them.
 */
export async function collectCaseEvidence(input: {
  symbol: string;
  interval: string;
  fingerprint: CaseFingerprint;
  patternName?: string | null;
  beforeMs?: number;
}): Promise<HistoricalCaseEvidence | null> {
  const [long, short] = await Promise.all([
    findSimilarCases({ ...input, direction: "buy" }),
    findSimilarCases({ ...input, direction: "sell" }),
  ]);
  if (!long.cases.length && !short.cases.length) return null;
  return {
    fingerprint: input.fingerprint,
    long: directional(long),
    short: directional(short),
    note:
      "حالات تاريخية مشابهة بنيوياً — دليل مساعد يُرجَّح مع غيره، وليس بوابة ولا حكماً مسبقاً على الاتجاه.",
  };
}
