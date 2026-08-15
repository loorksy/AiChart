/**
 * Submitting a backtest — the half of the pipeline nothing performed.
 *
 * `recordPendingStrategyBacktest` existed with no caller, `runForexBacktest`
 * was reachable only from its own tests, and the exporter that would have fed
 * either was deleted. So the factory could advance a backtest it already had
 * and never start one, and `strategy_deployments` stayed empty on every
 * install — which is why G5 had nothing to grade.
 *
 * This closes it: catalogue entry → strategy spec → gold bars from the store →
 * research job → a pending `strategy_backtests` row the existing
 * `refreshStrategyBacktest` can then drive to completion.
 *
 * ## Why the cache is the "lightning"
 *
 * A strategy's result over a fixed window of CLOSED bars cannot change. Making
 * backtests fast is therefore not a matter of running them faster — it is not
 * running them again. `backtest_results` is keyed on the whole claim (strategy,
 * spec revision, timeframe, and exactly which bars), so a repeat is a database
 * read and a genuine change — a spec bump, a deeper store — misses the cache
 * and re-runs, which is what a cache that cannot lie has to do.
 */
import { createHash } from "node:crypto";
import { execute, query, queryOne } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { DATA_SYMBOL } from "@/lib/gold";
import { goldCandleRange, STORED_TIMEFRAMES } from "@/lib/gold/candleStore";
import { exportGoldWarehouseEnvelope, MAX_EXPORT_ROWS } from "@/lib/research/warehouse";
import { runForexBacktest } from "@/lib/research/jobs";
import type { ResearchTimeframe } from "@/lib/research/types";
import {
  BACKTEST_STRATEGY_IDS,
  CATALOG_SPEC_REVISION,
  buildBacktestStrategySpec,
} from "./catalog";
import {
  DEFAULT_BACKTEST_ACCOUNT_CURRENCY,
  DEFAULT_BACKTEST_NOTIONAL_CAPITAL,
} from "./backtestCapital";
import { getLiveCostProfile, staticTypicalSpreadPips } from "./liveCostProfile";
import { recordPendingStrategyBacktest } from "./evidence";
import { MIN_BACKTEST_TRADES } from "./thresholds";

const log = createLogger("strategy.backtest-runner");

/**
 * Bars a run needs before it is worth submitting.
 *
 * The evidence bar is {@link MIN_BACKTEST_TRADES} completed trades, and a
 * strategy does not trade every bar. Submitting a job over a few hundred bars
 * burns a research slot to produce a sample too thin to cite — which the
 * evidence gate would then refuse anyway.
 */
export const MIN_BARS_FOR_BACKTEST = 5_000;

export type BacktestCacheStatus = "pending" | "complete" | "failed";

export interface BacktestCacheRow {
  cacheKey: string;
  strategyId: string;
  specRevision: string;
  timeframe: string;
  barsFrom: number;
  barsTo: number;
  barCount: number;
  backtestId: number | null;
  jobId: string | null;
  status: BacktestCacheStatus;
  tradeCount: number | null;
  winRate: number | null;
  updatedAt: number;
}

/**
 * The identity of a backtest claim.
 *
 * Every input that could change the answer is in the key. The bar RANGE and
 * COUNT are both present on purpose: a range alone would collide when the store
 * backfills a hole inside a window it already covered, and the result would be
 * served from a run that never saw those bars.
 */
export function backtestCacheKey(input: {
  strategyId: string;
  specRevision: string;
  timeframe: string;
  barsFrom: number;
  barsTo: number;
  barCount: number;
}): string {
  return createHash("sha256")
    .update(
      [
        input.strategyId,
        input.specRevision,
        input.timeframe,
        input.barsFrom,
        input.barsTo,
        input.barCount,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

export async function readBacktestCache(cacheKey: string): Promise<BacktestCacheRow | null> {
  const row = await queryOne<{
    cache_key: string;
    strategy_id: string;
    spec_revision: string;
    timeframe: string;
    bars_from: number;
    bars_to: number;
    bar_count: number;
    backtest_id: number | null;
    job_id: string | null;
    status: string;
    trade_count: number | null;
    win_rate: number | null;
    updated_at: number;
  }>("SELECT * FROM backtest_results WHERE cache_key = ?", [cacheKey]).catch(() => null);
  if (!row) return null;
  return {
    cacheKey: row.cache_key,
    strategyId: row.strategy_id,
    specRevision: row.spec_revision,
    timeframe: row.timeframe,
    barsFrom: Number(row.bars_from),
    barsTo: Number(row.bars_to),
    barCount: Number(row.bar_count),
    backtestId: row.backtest_id == null ? null : Number(row.backtest_id),
    jobId: row.job_id,
    status: row.status as BacktestCacheStatus,
    tradeCount: row.trade_count == null ? null : Number(row.trade_count),
    winRate: row.win_rate == null ? null : Number(row.win_rate),
    updatedAt: Number(row.updated_at),
  };
}

async function writeBacktestCache(row: Omit<BacktestCacheRow, "updatedAt">): Promise<void> {
  const now = Date.now();
  await execute(
    `INSERT INTO backtest_results
       (cache_key, strategy_id, spec_revision, timeframe, bars_from, bars_to,
        bar_count, backtest_id, job_id, status, trade_count, win_rate,
        metrics_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'{}',?,?)
     ON CONFLICT (cache_key) DO UPDATE SET
       backtest_id = excluded.backtest_id,
       job_id = excluded.job_id,
       status = excluded.status,
       trade_count = excluded.trade_count,
       win_rate = excluded.win_rate,
       updated_at = excluded.updated_at`,
    [
      row.cacheKey,
      row.strategyId,
      row.specRevision,
      row.timeframe,
      row.barsFrom,
      row.barsTo,
      row.barCount,
      row.backtestId,
      row.jobId,
      row.status,
      row.tradeCount,
      row.winRate,
      now,
      now,
    ],
  );
}

export type SubmitOutcome =
  | { status: "cached"; row: BacktestCacheRow }
  | { status: "submitted"; backtestId: number; jobId: string; cacheKey: string }
  | { status: "skipped"; reason: "insufficient_bars" | "unknown_strategy" | "provider_failed" };

/**
 * Submit ONE strategy on ONE timeframe, or return the cached answer.
 *
 * Never throws. A research service that is down, a store that is too shallow,
 * an unknown strategy id — each ends the call with a named reason, because this
 * runs from a cron sweep across dozens of strategies and one failure must not
 * take the sweep with it.
 */
export async function submitStrategyBacktest(input: {
  userId: number;
  requestId: string;
  strategyId: string;
  timeframe: string;
  /** Skip the cache and re-run. For a manual re-check, never for the sweep. */
  force?: boolean;
}): Promise<SubmitOutcome> {
  if (!BACKTEST_STRATEGY_IDS.includes(input.strategyId)) {
    return { status: "skipped", reason: "unknown_strategy" };
  }
  if (!STORED_TIMEFRAMES.includes(input.timeframe)) {
    return { status: "skipped", reason: "insufficient_bars" };
  }

  const range = await goldCandleRange(input.timeframe);
  if (
    range.oldest == null ||
    range.newest == null ||
    range.count < MIN_BARS_FOR_BACKTEST
  ) {
    return { status: "skipped", reason: "insufficient_bars" };
  }

  const cacheKey = backtestCacheKey({
    strategyId: input.strategyId,
    specRevision: CATALOG_SPEC_REVISION,
    timeframe: input.timeframe,
    barsFrom: range.oldest,
    barsTo: range.newest,
    barCount: range.count,
  });

  if (!input.force) {
    const cached = await readBacktestCache(cacheKey);
    // A pending row counts as a hit: the job is already in flight, and
    // submitting a second one for the same claim would double the research
    // spend to produce the same answer.
    if (cached) return { status: "cached", row: cached };
  }

  try {
    // Costs come from the observed session profile, never a guess. A backtest
    // priced at a spread the market never charged is the most flattering lie a
    // strategy factory can tell itself, so an unavailable profile falls back to
    // the static model the rest of the platform already uses — labelled, not
    // invented.
    const profile = await getLiveCostProfile(DATA_SYMBOL);
    const observed = profile.sessions
      .map((session) => session.typicalSpreadPips)
      .filter((value): value is number => value != null);
    const slippage = profile.sessions
      .map((session) => session.estimatedSlippagePips)
      .filter((value): value is number => value != null);
    const spreadPips =
      observed.length > 0
        ? observed.reduce((sum, value) => sum + value, 0) / observed.length
        : (staticTypicalSpreadPips(DATA_SYMBOL) ?? 20);
    const spec = buildBacktestStrategySpec({
      strategyId: input.strategyId,
      symbol: DATA_SYMBOL,
      timeframe: input.timeframe as ResearchTimeframe,
      costs: {
        spreadPips,
        slippagePips:
          slippage.length > 0
            ? slippage.reduce((sum, value) => sum + value, 0) / slippage.length
            : spreadPips * 0.25,
        commissionPerLotSideUsd: profile.commissionPerLot ?? 0,
      },
    });
    const dataset = await exportGoldWarehouseEnvelope({
      symbol: DATA_SYMBOL,
      timeframe: input.timeframe as ResearchTimeframe,
      limit: MAX_EXPORT_ROWS,
    });

    const job = await runForexBacktest(
      { userId: input.userId, requestId: input.requestId },
      {
        // The claim's identity is also the job's: an identical submission that
        // races or retries resolves to the same research run rather than a
        // second one.
        idempotencyKey: `backtest:${cacheKey}`,
        strategySpec: spec,
        dataset: { source: "aichart_candle_warehouse", payload: dataset },
        runConfig: {
          initialCapital: DEFAULT_BACKTEST_NOTIONAL_CAPITAL,
          accountCurrency: DEFAULT_BACKTEST_ACCOUNT_CURRENCY,
          // Fixed seed: two runs of the same strategy over the same bars must
          // agree, or the cache above would be caching a coin flip.
          seed: 20260101,
          // When a bar touched both the stop and the target, assume the stop
          // came first. A backtest that guessed the friendlier order would
          // report an edge the tape never offered.
          intrabarPolicy: "worst_case",
        },
      },
    );

    const evidence = await recordPendingStrategyBacktest({
      userId: input.userId,
      strategyId: input.strategyId,
      strategyVersion: CATALOG_SPEC_REVISION,
      symbol: DATA_SYMBOL,
      timeframe: input.timeframe,
      jobId: job.job.job_id,
      request: { cacheKey, bars: range.count },
    });

    await writeBacktestCache({
      cacheKey,
      strategyId: input.strategyId,
      specRevision: CATALOG_SPEC_REVISION,
      timeframe: input.timeframe,
      barsFrom: range.oldest,
      barsTo: range.newest,
      barCount: range.count,
      backtestId: evidence.id,
      jobId: job.job.job_id,
      status: "pending",
      tradeCount: null,
      winRate: null,
    });

    return {
      status: "submitted",
      backtestId: evidence.id,
      jobId: job.job.job_id,
      cacheKey,
    };
  } catch (error) {
    log.warn("backtest.submit_failed", {
      strategyId: input.strategyId,
      timeframe: input.timeframe,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "skipped", reason: "provider_failed" };
  }
}

/** Record a finished run against its cache key, so the next sweep reads it. */
export async function settleBacktestCache(input: {
  cacheKey: string;
  status: "complete" | "failed";
  tradeCount?: number | null;
  winRate?: number | null;
}): Promise<void> {
  await execute(
    `UPDATE backtest_results
        SET status = ?, trade_count = ?, win_rate = ?, updated_at = ?
      WHERE cache_key = ?`,
    [
      input.status,
      input.tradeCount ?? null,
      input.winRate ?? null,
      Date.now(),
      input.cacheKey,
    ],
  );
}

export interface SweepReport {
  submitted: number;
  cached: number;
  skipped: Record<string, number>;
}

/**
 * One pass across the catalogue.
 *
 * Bounded by `maxSubmissions` rather than by the catalogue's size: ~60
 * strategies × 5 timeframes is 300 research jobs, and firing them in one night
 * would spend a month of budget on the first run. The cache makes the sweep
 * resumable — every run picks up the claims the last one did not reach, and
 * re-reads the ones it did.
 */
export async function sweepStrategyBacktests(input: {
  userId: number;
  requestId: string;
  timeframes?: readonly string[];
  maxSubmissions?: number;
}): Promise<SweepReport> {
  const timeframes = input.timeframes ?? STORED_TIMEFRAMES;
  const budget = Math.max(1, Math.min(50, input.maxSubmissions ?? 10));
  const report: SweepReport = { submitted: 0, cached: 0, skipped: {} };

  for (const timeframe of timeframes) {
    for (const strategyId of BACKTEST_STRATEGY_IDS) {
      if (report.submitted >= budget) return report;
      const outcome = await submitStrategyBacktest({
        userId: input.userId,
        requestId: input.requestId,
        strategyId,
        timeframe,
      });
      if (outcome.status === "submitted") report.submitted += 1;
      else if (outcome.status === "cached") report.cached += 1;
      else report.skipped[outcome.reason] = (report.skipped[outcome.reason] ?? 0) + 1;
    }
  }
  return report;
}

/** Cached results for one timeframe, newest first — the sweep's own dashboard. */
export async function listBacktestCache(
  timeframe?: string,
  limit = 50,
): Promise<BacktestCacheRow[]> {
  const rows = await query<{ cache_key: string }>(
    timeframe
      ? `SELECT cache_key FROM backtest_results WHERE timeframe = ?
          ORDER BY updated_at DESC LIMIT ?`
      : `SELECT cache_key FROM backtest_results ORDER BY updated_at DESC LIMIT ?`,
    timeframe ? [timeframe, Math.max(1, Math.min(200, limit))] : [Math.max(1, Math.min(200, limit))],
  ).catch(() => []);
  const out: BacktestCacheRow[] = [];
  for (const row of rows) {
    const full = await readBacktestCache(row.cache_key);
    if (full) out.push(full);
  }
  return out;
}
