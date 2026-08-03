/**
 * Mass-backtest pipeline: the driver that fills the strategy catalog with
 * validated evidence — WITHOUT touching a single statistical gate.
 *
 * Three responsibilities:
 *  1. `submitStrategyBacktest` — the one submit flow (cost evidence →
 *     warehouse export → declarative spec → research job → pending row),
 *     shared by the manual POST /api/agent/backtest route and the pipeline.
 *  2. `runStrategyPipelineTick` — every cron tick, ADVANCE up to `batch`
 *     in-flight backtests through the existing `refreshStrategyBacktest`
 *     state machine (nothing else drives pending rows to terminal), and
 *     SUBMIT new (strategy × symbol × timeframe) combos that have no row for
 *     the current catalog revision. Batch 2 per 10-min tick ≈ ≤12 jobs/hour —
 *     paced for the single-concurrency research container.
 *  3. `getStrategyPipelineStatus` — state counts so catalog health (and WHICH
 *     gate kills candidates) is one call away.
 *
 * The heavy work (export + research HTTP) runs in BullMQ jobs, never inside
 * the cron request. The cron route no-ops without REDIS_URL by design.
 */
import { randomUUID } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { barDurationMs } from "@/lib/intervals";
import { normalizeSymbol } from "@/lib/markets/symbolMapping";
import {
  exportAiChartCandleWarehouse,
  researchValidationEnabled,
  runForexBacktest,
} from "@/lib/research";
import type { ResearchTimeframe } from "@/lib/research";
import { enqueue } from "@/lib/queue";
import { createLogger } from "@/lib/logger";
import {
  BACKTEST_STRATEGY_IDS,
  CATALOG_SPEC_REVISION,
  LEGACY_STRATEGY_IDS,
  buildBacktestStrategySpec,
  isBacktestStrategyId,
} from "./catalog";
import { catalogEntriesForTimeframe } from "./catalogGen";
import {
  DEFAULT_BACKTEST_ACCOUNT_CURRENCY,
  DEFAULT_BACKTEST_NOTIONAL_CAPITAL,
} from "./backtestCapital";
import { getStrategyCostEvidence } from "./costProfile";
import { recordPendingStrategyBacktest } from "./evidence";
import { canonicalStrategyTimeframe } from "./matchingKeys";

const log = createLogger("strategy-pipeline");

export const MAX_BACKTEST_BARS = 50_000;

/** How long a `failed` row rests before the pipeline re-offers it. */
export const FAILED_RETRY_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Per-timeframe history depth (months), sized so the CALENDAR range stays
 * inside the 50k-bar export budget while giving the 100-trade gate enough
 * sample. Scalp frames are shallower in months but far denser in bars.
 */
const LOOKBACK_MONTHS: Record<ResearchTimeframe, number> = {
  "1m": 1, // ~43k bars
  "5m": 5, // ~43k bars
  "15m": 12,
  "30m": 24,
  "1h": 36,
  "4h": 60,
  "1d": 60,
};

function backtestTimeoutSeconds(): number {
  const raw = Number(process.env.STRATEGY_BACKTEST_TIMEOUT_SECONDS);
  if (!Number.isFinite(raw)) return 300;
  return Math.min(Math.max(Math.floor(raw), 60), 3600);
}

export interface SubmitStrategyBacktestInput {
  userId: number;
  strategyId: string;
  symbol: string;
  timeframe: ResearchTimeframe;
  fromMs: number;
  toMs: number;
  notionalCapital?: number;
  requestId?: string;
}

export class PipelineSubmitError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PipelineSubmitError";
  }
}

/**
 * The ONE submit flow. Throws PipelineSubmitError with an HTTP-ish status so
 * the manual route can map it onto its response codes.
 */
export async function submitStrategyBacktest(input: SubmitStrategyBacktestInput) {
  if (!isBacktestStrategyId(input.strategyId)) {
    throw new PipelineSubmitError(
      "strategy_id is not present in the backtested strategy catalog",
      409,
    );
  }
  if (!researchValidationEnabled()) {
    throw new PipelineSubmitError(
      "The complete backtest + validation pipeline is disabled; enable RESEARCH_SERVICE_ENABLED, RESEARCH_BACKTEST_ENABLED, and RESEARCH_VALIDATION_ENABLED",
      503,
    );
  }
  const symbol = normalizeSymbol(input.symbol).canonical;
  const { fromMs, toMs } = input;
  if (!(fromMs > 0 && toMs > fromMs && toMs <= Date.now())) {
    throw new PipelineSubmitError("date_range must be ordered and end in the past", 400);
  }
  const estimatedBars = Math.ceil((toMs - fromMs) / barDurationMs(input.timeframe));
  if (estimatedBars > MAX_BACKTEST_BARS) {
    throw new PipelineSubmitError(
      `This run exceeds ${MAX_BACKTEST_BARS.toLocaleString()} bars; use a higher timeframe or a shorter range`,
      400,
    );
  }

  const notionalCapital = input.notionalCapital ?? DEFAULT_BACKTEST_NOTIONAL_CAPITAL;

  let costs;
  try {
    costs = await getStrategyCostEvidence(input.userId, symbol);
  } catch (error) {
    throw new PipelineSubmitError(
      error instanceof Error
        ? `Backtest cost profile unavailable: ${error.message}. Set BACKTEST_SPREAD_PIPS.`
        : "Backtest cost profile unavailable",
      409,
    );
  }

  const dataset = await exportAiChartCandleWarehouse({
    symbol,
    timeframe: input.timeframe,
    fromMs,
    toMs,
    limit: MAX_BACKTEST_BARS,
  });
  if (dataset.bars.length < 200) {
    throw new PipelineSubmitError(
      `Historical warehouse coverage is insufficient (${dataset.bars.length} closed bars; at least 200 required). Run candle-warehouse backfill or shorten the date_range.`,
      409,
    );
  }
  // DEPTH guard: 200 bars clears "has data" but not "has a testable sample".
  // Submitting a 30-day 1m request against 10 days of warehouse produces an
  // honest-looking `ineligible: <100 trades` that actually means "we never
  // had the data" — and it BURNS the target, so the whole wave would have to
  // be re-run under a new revision once depth arrives. Skipping instead
  // leaves the target outstanding, so the pipeline self-heals as the
  // warehouse fills. Forex trades ~5/7 of calendar time, so half the
  // calendar-bar count is a conservative floor.
  const expectedCalendarBars = Math.ceil(
    (toMs - fromMs) / barDurationMs(input.timeframe),
  );
  const minimumDepth = Math.max(200, Math.floor(expectedCalendarBars * 0.5));
  if (dataset.bars.length < minimumDepth) {
    throw new PipelineSubmitError(
      `Warehouse depth is too shallow for a ${input.timeframe} sample: ${dataset.bars.length} bars available, ${minimumDepth} needed for the requested range. Backfill ${symbol} ${input.timeframe} first — the target stays queued.`,
      409,
    );
  }

  const strategySpec = buildBacktestStrategySpec({
    strategyId: input.strategyId,
    symbol,
    timeframe: input.timeframe,
    costs,
  });
  const strategyVersion =
    typeof strategySpec.version_id === "string"
      ? strategySpec.version_id
      : `${input.strategyId}.${CATALOG_SPEC_REVISION}`;
  const idempotencyKey = [
    "strategy-backtest",
    input.userId,
    input.strategyId,
    strategyVersion,
    symbol,
    input.timeframe,
    fromMs,
    toMs,
    notionalCapital,
  ].join(":");

  const created = await runForexBacktest(
    { userId: input.userId, requestId: input.requestId ?? randomUUID() },
    {
      idempotencyKey,
      timeoutSeconds: backtestTimeoutSeconds(),
      strategySpec,
      dataset: { source: "aichart_candle_warehouse", payload: dataset },
      runConfig: {
        initialCapital: notionalCapital,
        accountCurrency: DEFAULT_BACKTEST_ACCOUNT_CURRENCY,
        seed: 42,
        intrabarPolicy: "worst_case",
        leverage: 30,
        startTime: new Date(fromMs).toISOString(),
        endTime: new Date(toMs).toISOString(),
      },
      limits: {
        maxRows: MAX_BACKTEST_BARS,
        maxSymbols: 1,
        maxDateRangeDays: Math.ceil((toMs - fromMs) / 86_400_000) + 1,
      },
    },
  );
  const backtest = await recordPendingStrategyBacktest({
    userId: input.userId,
    strategyId: input.strategyId,
    strategyVersion,
    symbol,
    timeframe: input.timeframe,
    jobId: created.job.job_id,
    request: {
      date_range: {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      },
      candle_count: dataset.bars.length,
      cost_evidence: costs,
      initial_capital: notionalCapital,
      account_currency: DEFAULT_BACKTEST_ACCOUNT_CURRENCY,
      capital_source: "notional_simulation",
    },
  });
  return { created, backtest, notionalCapital };
}

// --- Pipeline configuration -----------------------------------------------------

export interface PipelineConfig {
  userId: number | null;
  symbols: string[];
  timeframes: ResearchTimeframe[];
  batch: number;
}

export function pipelineConfig(): PipelineConfig {
  const userIdRaw = Number(process.env.STRATEGY_PIPELINE_USER_ID);
  const symbols = (process.env.STRATEGY_PIPELINE_SYMBOLS ?? "XAUUSD")
    .split(",")
    .map((value) => normalizeSymbol(value.trim()).canonical)
    .filter((value) => /^[A-Z]{6}$/.test(value));
  // Scalping is the product: 1m/5m lead, 15m is the ceiling for the default
  // wave. Slower frames remain available by explicit configuration.
  const timeframes = (process.env.STRATEGY_PIPELINE_TIMEFRAMES ?? "1m,5m,15m")
    .split(",")
    .map((value) => canonicalStrategyTimeframe(value.trim()))
    .filter((value): value is ResearchTimeframe => value != null);
  const batchRaw = Number(process.env.STRATEGY_PIPELINE_BATCH);
  return {
    userId: Number.isSafeInteger(userIdRaw) && userIdRaw > 0 ? userIdRaw : null,
    symbols: symbols.length ? [...new Set(symbols)] : ["XAUUSD"],
    timeframes: timeframes.length ? [...new Set(timeframes)] : ["1m", "5m", "15m"],
    batch: Number.isFinite(batchRaw)
      ? Math.min(Math.max(Math.floor(batchRaw), 1), MAX_PIPELINE_BATCH)
      : 2,
  };
}

/**
 * Ceiling on strategies advanced per cron tick (RELIABILITY_PLAN.md item 18,
 * step 1 — pipeline throughput).
 *
 * IMPORTANT, and the reason the default stays at 2: this number is NOT the real
 * bottleneck on its own. The research service processes
 * `RESEARCH_SERVICE_MAX_CONCURRENT_JOBS` backtests at a time (default 1), so
 * raising the batch alone only makes the queue longer — the throughput ceiling
 * is `min(batch, service concurrency)`. Raising this without matching the
 * service (and its CPU) trades one bottleneck for a queue, and on a shared box
 * it can starve the live analysis path the operator actually waits on.
 *
 * To genuinely raise throughput, raise BOTH, then watch queue depth and
 * event-loop lag (item 9 metrics) before going further.
 */
export const MAX_PIPELINE_BATCH = 16;

export interface PipelineTarget {
  strategyId: string;
  symbol: string;
  timeframe: ResearchTimeframe;
}

/**
 * Deterministic work matrix: TIMEFRAME-APPROPRIATE catalog × symbols ×
 * timeframes. Scalp frames get the scalp-native families (plus fast general
 * ones); slower frames skip them. Running every strategy on every timeframe
 * would spend most of the pipeline's capacity on combinations that cannot
 * resolve inside their own horizon.
 */
export function pipelineTargets(config: PipelineConfig): PipelineTarget[] {
  const out: PipelineTarget[] = [];
  for (const symbol of config.symbols) {
    for (const timeframe of config.timeframes) {
      const ids = [
        ...LEGACY_STRATEGY_IDS,
        ...catalogEntriesForTimeframe(timeframe).map((entry) => entry.id),
      ];
      for (const strategyId of ids) {
        out.push({ strategyId, symbol, timeframe });
      }
    }
  }
  return out;
}

export function pipelineDateRange(timeframe: ResearchTimeframe): {
  fromMs: number;
  toMs: number;
} {
  const months = LOOKBACK_MONTHS[timeframe];
  // End one hour back so the newest (possibly forming) candle never taints
  // the closed-bars-only export.
  const toMs = Date.now() - 60 * 60 * 1000;
  const from = new Date(toMs);
  from.setUTCMonth(from.getUTCMonth() - months);
  return { fromMs: from.getTime(), toMs };
}

function targetKey(target: PipelineTarget): string {
  return `${target.strategyId}:${target.symbol}:${target.timeframe}`;
}

// --- The tick -----------------------------------------------------------------------

export interface PipelineTickResult {
  advanced: number;
  submitted: number;
  inflight: number;
  remainingTargets: number;
}

/**
 * One pipeline heartbeat. Enqueues work — never blocks the cron request on
 * research HTTP or warehouse exports.
 */
export async function runStrategyPipelineTick(
  config = pipelineConfig(),
): Promise<PipelineTickResult> {
  if (config.userId == null) {
    log.warn("STRATEGY_PIPELINE_USER_ID is not set — pipeline tick skipped");
    return { advanced: 0, submitted: 0, inflight: 0, remainingTargets: 0 };
  }
  const userId = config.userId;

  // 1) Advance in-flight rows (oldest first) through the evidence state machine.
  //
  // `failed` is included deliberately: a poll that times out while the engine
  // crunches a 40k-bar sample marks the row failed even though the research
  // job is alive and will finish. refreshStrategyBacktest already knows how to
  // resume those (only `eligible`/`ineligible` are terminal), but the pipeline
  // never re-offered them, so one transient 504 permanently stranded a target.
  // The cooldown stops a genuinely dead row from monopolising the batch.
  const failedRetryAfterMs = Date.now() - FAILED_RETRY_COOLDOWN_MS;
  const inflightRows = await query<{ id: number }>(
    `SELECT id FROM strategy_backtests
      WHERE user_id = ?
        AND (
          status IN ('pending', 'running', 'validating')
          OR (status = 'failed' AND updated_at < ?)
        )
      ORDER BY updated_at ASC, id ASC
      LIMIT 50`,
    [userId, failedRetryAfterMs],
  );
  const advanceBucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const toAdvance = inflightRows.slice(0, config.batch);
  for (const row of toAdvance) {
    await enqueue(
      "strategy_backtest_advance",
      { userId, backtestId: Number(row.id) },
      { idempotencyKey: `advance:${row.id}:${advanceBucket}` },
    );
  }

  // 2) Submit missing combos for the CURRENT catalog revision, respecting the
  //    in-flight cap so the research container's queue never floods.
  const capacity = Math.max(0, config.batch - inflightRows.length);
  let submitted = 0;
  let remainingTargets = 0;
  if (config.symbols.length && config.timeframes.length) {
    const existing = await query<{
      strategy_id: string;
      symbol: string;
      timeframe: string;
    }>(
      `SELECT strategy_id, symbol, timeframe FROM strategy_backtests
        WHERE user_id = ? AND strategy_version LIKE ?`,
      [userId, `%.${CATALOG_SPEC_REVISION}`],
    );
    const existingKeys = new Set(
      existing.map((row) =>
        targetKey({
          strategyId: row.strategy_id,
          symbol: row.symbol,
          timeframe: row.timeframe as ResearchTimeframe,
        }),
      ),
    );
    const missing = pipelineTargets(config).filter(
      (target) => !existingKeys.has(targetKey(target)),
    );
    remainingTargets = missing.length;

    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    for (const target of missing.slice(0, capacity)) {
      await enqueue(
        "strategy_backtest_submit",
        {
          userId,
          strategyId: target.strategyId,
          symbol: target.symbol,
          timeframe: target.timeframe,
        },
        // Hour-bucketed so a dead submit job retries next hour, while rapid
        // ticks never double-submit the same combo.
        { idempotencyKey: `submit:${targetKey(target)}:${hourBucket}` },
      );
      submitted += 1;
    }
  }

  return {
    advanced: toAdvance.length,
    submitted,
    inflight: inflightRows.length,
    remainingTargets,
  };
}

// --- Observability --------------------------------------------------------------------

export interface PipelineStatus {
  catalogSize: number;
  revision: string;
  targets: number;
  backtests: Record<string, number>;
  deployments: Record<string, number>;
  recentFailures: Array<{
    id: number;
    strategyId: string;
    symbol: string;
    timeframe: string;
    error: string | null;
  }>;
  ineligibleReasons: Array<{ reason: string; count: number }>;
}

export async function getStrategyPipelineStatus(
  userId: number,
): Promise<PipelineStatus> {
  const config = pipelineConfig();
  const statusRows = await query<{ status: string; n: number | string }>(
    `SELECT status, COUNT(*) AS n FROM strategy_backtests
      WHERE user_id = ? AND strategy_version LIKE ?
      GROUP BY status`,
    [userId, `%.${CATALOG_SPEC_REVISION}`],
  );
  const deploymentRows = await query<{ state: string; n: number | string }>(
    `SELECT state, COUNT(*) AS n FROM strategy_deployments
      WHERE user_id = ? GROUP BY state`,
    [userId],
  );
  const failures = await query<{
    id: number;
    strategy_id: string;
    symbol: string;
    timeframe: string;
    error_message: string | null;
  }>(
    `SELECT id, strategy_id, symbol, timeframe, error_message
       FROM strategy_backtests
      WHERE user_id = ? AND status IN ('failed', 'ineligible')
        AND strategy_version LIKE ?
      ORDER BY updated_at DESC LIMIT 8`,
    [userId, `%.${CATALOG_SPEC_REVISION}`],
  );
  const reasons = await query<{ error_message: string | null; n: number | string }>(
    `SELECT error_message, COUNT(*) AS n FROM strategy_backtests
      WHERE user_id = ? AND status = 'ineligible' AND strategy_version LIKE ?
      GROUP BY error_message ORDER BY n DESC LIMIT 6`,
    [userId, `%.${CATALOG_SPEC_REVISION}`],
  );

  return {
    catalogSize: BACKTEST_STRATEGY_IDS.length,
    revision: CATALOG_SPEC_REVISION,
    targets: pipelineTargets(config).length,
    backtests: Object.fromEntries(
      statusRows.map((row) => [row.status, Number(row.n)]),
    ),
    deployments: Object.fromEntries(
      deploymentRows.map((row) => [row.state, Number(row.n)]),
    ),
    recentFailures: failures.map((row) => ({
      id: Number(row.id),
      strategyId: row.strategy_id,
      symbol: row.symbol,
      timeframe: row.timeframe,
      error: row.error_message,
    })),
    ineligibleReasons: reasons.map((row) => ({
      reason: row.error_message ?? "(unspecified gate)",
      count: Number(row.n),
    })),
  };
}

/** True when the given user still has a row for this revision (idempotence probe). */
export async function hasBacktestForTarget(
  userId: number,
  target: PipelineTarget,
): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM strategy_backtests
      WHERE user_id = ? AND strategy_id = ? AND symbol = ? AND timeframe = ?
        AND strategy_version = ? LIMIT 1`,
    [
      userId,
      target.strategyId,
      target.symbol.toUpperCase(),
      target.timeframe,
      `${target.strategyId}.${CATALOG_SPEC_REVISION}`,
    ],
  );
  return row != null;
}
