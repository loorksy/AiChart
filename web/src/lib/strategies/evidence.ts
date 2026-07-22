import { execute, insertReturningId, query, queryOne } from "@/lib/db";
import {
  getResearchJob,
  getResearchJsonArtifact,
} from "@/lib/research/client";
import { runBacktestValidation } from "@/lib/research/jobs";
import type {
  ResearchArtifactReference,
  ResearchCallerContext,
} from "@/lib/research/types";

export const MIN_BACKTEST_TRADES = 100;
export const DECAY_SAMPLE_SIZE = 30;
export const MIN_SHADOW_OUTCOMES = 20;
export const MAX_WIN_RATE_DECAY = 0.15;

export type StrategyBacktestStatus =
  | "pending"
  | "running"
  | "validating"
  | "eligible"
  | "ineligible"
  | "failed";

export type StrategyDeploymentState = "shadow" | "active" | "suspended";

interface StrategyBacktestRow {
  id: number;
  user_id: number;
  strategy_id: string;
  strategy_version: string;
  symbol: string;
  timeframe: string;
  job_id: string;
  status: StrategyBacktestStatus;
  trade_count: number;
  win_rate: number | null;
  expectancy: number | null;
  sharpe_ratio: number | null;
  max_drawdown_pct: number | null;
  profit_factor: number | null;
  calibrated_confidence: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  metrics_json: string;
  validation_json: string;
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
  updated_at: number;
}

interface StrategyDeploymentRow {
  user_id: number;
  strategy_id: string;
  symbol: string;
  timeframe: string;
  backtest_id: number;
  state: StrategyDeploymentState;
  expected_win_rate: number;
  calibrated_confidence: number;
  confidence_low: number;
  confidence_high: number;
  live_sample_size: number;
  live_win_rate: number | null;
  suspended_reason: string | null;
  updated_at: number;
}

export interface StrategyBacktestEvidence {
  id: number;
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  timeframe: string;
  jobId: string;
  status: StrategyBacktestStatus;
  tradeCount: number;
  winRate: number | null;
  expectancy: number | null;
  sharpeRatio: number | null;
  maxDrawdownPct: number | null;
  profitFactor: number | null;
  calibratedConfidence: number | null;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  metrics: Record<string, unknown>;
  validation: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: number;
  completedAt: number | null;
  updatedAt: number;
}

export interface StrategyDeployment {
  strategyId: string;
  symbol: string;
  timeframe: string;
  backtestId: number;
  state: StrategyDeploymentState;
  expectedWinRate: number;
  calibratedConfidence: number;
  confidenceLow: number;
  confidenceHigh: number;
  liveSampleSize: number;
  liveWinRate: number | null;
  suspendedReason: string | null;
  updatedAt: number;
}

export interface CalibratedConfidence {
  confidence: number;
  low: number;
  high: number;
}

function jsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function finite(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toEvidence(row: StrategyBacktestRow): StrategyBacktestEvidence {
  return {
    id: Number(row.id),
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version,
    symbol: row.symbol,
    timeframe: row.timeframe,
    jobId: row.job_id,
    status: row.status,
    tradeCount: Number(row.trade_count),
    winRate: finite(row.win_rate),
    expectancy: finite(row.expectancy),
    sharpeRatio: finite(row.sharpe_ratio),
    maxDrawdownPct: finite(row.max_drawdown_pct),
    profitFactor: finite(row.profit_factor),
    calibratedConfidence: finite(row.calibrated_confidence),
    confidenceLow: finite(row.confidence_low),
    confidenceHigh: finite(row.confidence_high),
    metrics: jsonObject(row.metrics_json),
    validation: jsonObject(row.validation_json),
    errorMessage: row.error_message,
    createdAt: Number(row.created_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    updatedAt: Number(row.updated_at),
  };
}

function toDeployment(row: StrategyDeploymentRow): StrategyDeployment {
  return {
    strategyId: row.strategy_id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    backtestId: Number(row.backtest_id),
    state: row.state,
    expectedWinRate: Number(row.expected_win_rate),
    calibratedConfidence: Number(row.calibrated_confidence),
    confidenceLow: Number(row.confidence_low),
    confidenceHigh: Number(row.confidence_high),
    liveSampleSize: Number(row.live_sample_size),
    liveWinRate: finite(row.live_win_rate),
    suspendedReason: row.suspended_reason,
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Beta(1,1)-smoothed observed win rate plus a Wilson 95% interval.
 *
 * This is deliberately not labelled Platt/isotonic calibration: those methods
 * need per-trade prediction scores, which the deterministic strategies do not
 * currently emit.  The interval honestly widens for smaller samples.
 */
export function calibrateObservedWinRate(
  tradeCount: number,
  rawWinRate: number,
): CalibratedConfidence {
  const n = Math.max(0, Math.floor(tradeCount));
  const p = Math.max(0, Math.min(1, rawWinRate));
  if (n === 0) return { confidence: 50, low: 0, high: 100 };
  const wins = Math.max(0, Math.min(n, Math.round(p * n)));
  const posteriorMean = (wins + 1) / (n + 2);
  const z = 1.959963984540054;
  const denominator = 1 + (z * z) / n;
  const centre = (wins / n + (z * z) / (2 * n)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((wins / n) * (1 - wins / n) / n + (z * z) / (4 * n * n));
  const asPercent = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 100;
  return {
    confidence: asPercent(posteriorMean),
    low: asPercent(centre - margin),
    high: asPercent(centre + margin),
  };
}

export async function recordPendingStrategyBacktest(input: {
  userId: number;
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  timeframe: string;
  jobId: string;
  request: Record<string, unknown>;
}): Promise<StrategyBacktestEvidence> {
  const existing = await queryOne<StrategyBacktestRow>(
    "SELECT * FROM strategy_backtests WHERE user_id = ? AND job_id = ?",
    [input.userId, input.jobId],
  );
  if (existing) return toEvidence(existing);
  const now = Date.now();
  const id = await insertReturningId(
    `INSERT INTO strategy_backtests
      (user_id, strategy_id, strategy_version, symbol, timeframe, job_id,
       status, metrics_json, validation_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'pending', ?, '{}', ?, ?)`,
    [
      input.userId,
      input.strategyId,
      input.strategyVersion,
      input.symbol.toUpperCase(),
      input.timeframe,
      input.jobId,
      JSON.stringify({ request: input.request }),
      now,
      now,
    ],
  );
  const row = await queryOne<StrategyBacktestRow>(
    "SELECT * FROM strategy_backtests WHERE id = ? AND user_id = ?",
    [id, input.userId],
  );
  if (!row) throw new Error("Strategy backtest was not readable after creation");
  return toEvidence(row);
}

export async function getStrategyBacktest(
  userId: number,
  backtestId: number,
): Promise<StrategyBacktestEvidence | null> {
  const row = await queryOne<StrategyBacktestRow>(
    "SELECT * FROM strategy_backtests WHERE id = ? AND user_id = ?",
    [backtestId, userId],
  );
  return row ? toEvidence(row) : null;
}

export async function getLatestStrategyBacktest(
  userId: number,
  strategyId: string,
  symbol?: string,
  timeframe?: string,
): Promise<StrategyBacktestEvidence | null> {
  const conditions = ["user_id = ?", "strategy_id = ?"];
  const params: unknown[] = [userId, strategyId];
  if (symbol) {
    conditions.push("symbol = ?");
    params.push(symbol.toUpperCase());
  }
  if (timeframe) {
    conditions.push("timeframe = ?");
    params.push(timeframe);
  }
  const row = await queryOne<StrategyBacktestRow>(
    `SELECT * FROM strategy_backtests WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    params,
  );
  return row ? toEvidence(row) : null;
}

function artifact(
  refs: ResearchArtifactReference[],
  name: string,
): ResearchArtifactReference | null {
  return refs.find((item) => item.name === name) ?? null;
}

async function updateBacktest(
  userId: number,
  id: number,
  patch: {
    status?: StrategyBacktestStatus;
    tradeCount?: number;
    winRate?: number | null;
    expectancy?: number | null;
    sharpeRatio?: number | null;
    maxDrawdownPct?: number | null;
    profitFactor?: number | null;
    calibrated?: CalibratedConfidence | null;
    metrics?: Record<string, unknown>;
    validation?: Record<string, unknown>;
    errorMessage?: string | null;
    completedAt?: number | null;
  },
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.tradeCount !== undefined) set("trade_count", patch.tradeCount);
  if (patch.winRate !== undefined) set("win_rate", patch.winRate);
  if (patch.expectancy !== undefined) set("expectancy", patch.expectancy);
  if (patch.sharpeRatio !== undefined) set("sharpe_ratio", patch.sharpeRatio);
  if (patch.maxDrawdownPct !== undefined) set("max_drawdown_pct", patch.maxDrawdownPct);
  if (patch.profitFactor !== undefined) set("profit_factor", patch.profitFactor);
  if (patch.calibrated !== undefined) {
    set("calibrated_confidence", patch.calibrated?.confidence ?? null);
    set("confidence_low", patch.calibrated?.low ?? null);
    set("confidence_high", patch.calibrated?.high ?? null);
  }
  if (patch.metrics !== undefined) set("metrics_json", JSON.stringify(patch.metrics));
  if (patch.validation !== undefined) set("validation_json", JSON.stringify(patch.validation));
  if (patch.errorMessage !== undefined) set("error_message", patch.errorMessage);
  if (patch.completedAt !== undefined) set("completed_at", patch.completedAt);
  set("updated_at", Date.now());
  values.push(id, userId);
  await execute(
    `UPDATE strategy_backtests SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
    values,
  );
}

async function upsertDeployment(
  userId: number,
  backtest: StrategyBacktestEvidence,
): Promise<void> {
  if (
    backtest.winRate == null ||
    backtest.calibratedConfidence == null ||
    backtest.confidenceLow == null ||
    backtest.confidenceHigh == null
  ) {
    throw new Error("Eligible backtest is missing calibrated evidence");
  }
  const existing = await queryOne<StrategyDeploymentRow>(
    `SELECT * FROM strategy_deployments
      WHERE user_id = ? AND strategy_id = ? AND symbol = ? AND timeframe = ?`,
    [userId, backtest.strategyId, backtest.symbol, backtest.timeframe],
  );
  const keepState = existing?.backtest_id === backtest.id;
  const state: StrategyDeploymentState = keepState ? existing.state : "shadow";
  await execute(
    `INSERT INTO strategy_deployments
      (user_id, strategy_id, symbol, timeframe, backtest_id, state,
       expected_win_rate, calibrated_confidence, confidence_low, confidence_high,
       live_sample_size, live_win_rate, suspended_reason, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (user_id, strategy_id, symbol, timeframe) DO UPDATE SET
       backtest_id = excluded.backtest_id,
       state = excluded.state,
       expected_win_rate = excluded.expected_win_rate,
       calibrated_confidence = excluded.calibrated_confidence,
       confidence_low = excluded.confidence_low,
       confidence_high = excluded.confidence_high,
       live_sample_size = excluded.live_sample_size,
       live_win_rate = excluded.live_win_rate,
       suspended_reason = excluded.suspended_reason,
       updated_at = excluded.updated_at`,
    [
      userId,
      backtest.strategyId,
      backtest.symbol,
      backtest.timeframe,
      backtest.id,
      state,
      backtest.winRate,
      backtest.calibratedConfidence,
      backtest.confidenceLow,
      backtest.confidenceHigh,
      keepState ? existing.live_sample_size : 0,
      keepState ? existing.live_win_rate : null,
      keepState ? existing.suspended_reason : null,
      Date.now(),
    ],
  );
}

const READY_FOR_SHADOW = new Set([
  "paper_ready",
  "demo_ready",
  "live_candidate",
]);

async function finalizeValidation(
  context: ResearchCallerContext,
  row: StrategyBacktestRow,
  validationState: Record<string, unknown>,
): Promise<void> {
  const validationJobId = String(validationState.validation_job_id ?? "");
  if (!validationJobId) throw new Error("Validation job reference is missing");
  const job = await getResearchJob(context, validationJobId);
  if (["queued", "running", "retry_wait", "cancelling"].includes(job.status)) return;
  if (job.status !== "succeeded") {
    await updateBacktest(context.userId, row.id, {
      status: "failed",
      validation: { ...validationState, job_status: job.status },
      errorMessage: job.error_message ?? `Validation ${job.status}`,
      completedAt: Date.now(),
    });
    return;
  }
  const readinessRef = artifact(job.artifact_refs, "readiness.json");
  if (!readinessRef) throw new Error("Validation readiness artifact is missing");
  const readiness = await getResearchJsonArtifact(
    context,
    validationJobId,
    readinessRef.artifact_id,
  );
  const readinessStatus = String(readiness.readiness_status ?? "rejected");
  const eligible =
    READY_FOR_SHADOW.has(readinessStatus) &&
    readiness.live_trading_authorized === false;
  await updateBacktest(context.userId, row.id, {
    status: eligible ? "eligible" : "ineligible",
    validation: {
      ...validationState,
      job_status: job.status,
      readiness,
      readiness_artifact_id: readinessRef.artifact_id,
    },
    errorMessage: eligible ? null : `Readiness gate: ${readinessStatus}`,
    completedAt: Date.now(),
  });
  if (eligible) {
    const refreshed = await getStrategyBacktest(context.userId, row.id);
    if (refreshed) await upsertDeployment(context.userId, refreshed);
  }
}

/** Reconciles one asynchronous backtest through metrics and validation gates. */
export async function refreshStrategyBacktest(
  context: ResearchCallerContext,
  backtestId: number,
): Promise<StrategyBacktestEvidence | null> {
  const row = await queryOne<StrategyBacktestRow>(
    "SELECT * FROM strategy_backtests WHERE id = ? AND user_id = ?",
    [backtestId, context.userId],
  );
  if (!row) return null;
  if (["eligible", "ineligible", "failed"].includes(row.status)) return toEvidence(row);

  try {
    if (row.status === "validating") {
      await finalizeValidation(context, row, jsonObject(row.validation_json));
      return getStrategyBacktest(context.userId, row.id);
    }

    const job = await getResearchJob(context, row.job_id);
    if (["queued", "running", "retry_wait", "cancelling"].includes(job.status)) {
      await updateBacktest(context.userId, row.id, {
        status: job.status === "queued" ? "pending" : "running",
      });
      return getStrategyBacktest(context.userId, row.id);
    }
    if (job.status !== "succeeded") {
      await updateBacktest(context.userId, row.id, {
        status: "failed",
        errorMessage: job.error_message ?? `Backtest ${job.status}`,
        completedAt: Date.now(),
      });
      return getStrategyBacktest(context.userId, row.id);
    }

    const metricsRef = artifact(job.artifact_refs, "metrics.json");
    const tradesRef = artifact(job.artifact_refs, "trades.csv");
    const equityRef = artifact(job.artifact_refs, "equity.csv");
    const runConfigRef = artifact(job.artifact_refs, "run_config.json");
    if (!metricsRef || !tradesRef || !equityRef || !runConfigRef) {
      throw new Error("Backtest evidence artifacts are incomplete");
    }
    const metrics = await getResearchJsonArtifact(
      context,
      row.job_id,
      metricsRef.artifact_id,
    );
    const tradeCount = Math.max(0, Math.floor(finite(metrics.trade_count) ?? 0));
    const winRate = Math.max(0, Math.min(1, finite(metrics.win_rate) ?? 0));
    const calibrated = calibrateObservedWinRate(tradeCount, winRate);
    const storedMetrics = {
      ...jsonObject(row.metrics_json),
      metrics,
      artifacts: {
        metrics: metricsRef.artifact_id,
        trades: tradesRef.artifact_id,
        equity: equityRef.artifact_id,
        run_config: runConfigRef.artifact_id,
      },
    };
    await updateBacktest(context.userId, row.id, {
      tradeCount,
      winRate,
      expectancy: finite(metrics.expectancy),
      sharpeRatio: finite(metrics.sharpe_ratio),
      maxDrawdownPct: finite(metrics.maximum_drawdown_percent),
      profitFactor: finite(metrics.profit_factor),
      calibrated,
      metrics: storedMetrics,
    });
    if (tradeCount < MIN_BACKTEST_TRADES) {
      await updateBacktest(context.userId, row.id, {
        status: "ineligible",
        validation: {
          readiness: {
            readiness_status: "needs_more_data",
            failed_gates: ["minimum_trade_count"],
            required_trade_count: MIN_BACKTEST_TRADES,
            observed_trade_count: tradeCount,
            live_trading_authorized: false,
          },
        },
        errorMessage: `Minimum ${MIN_BACKTEST_TRADES} historical trades required`,
        completedAt: Date.now(),
      });
      return getStrategyBacktest(context.userId, row.id);
    }

    const validation = await runBacktestValidation(context, {
      idempotencyKey: `strategy-validation:${row.job_id}`,
      timeoutSeconds: 300,
      backtestRun: {
        jobId: row.job_id,
        metricsArtifactId: metricsRef.artifact_id,
        tradesArtifactId: tradesRef.artifact_id,
        equityArtifactId: equityRef.artifact_id,
        runConfigArtifactId: runConfigRef.artifact_id,
      },
      validationConfig: {
        seed: 42,
        simulationCount: 1_000,
        methods: [
          "trade_order_permutation",
          "trade_return_bootstrap",
          "execution_cost_stress",
        ],
        bootstrapSamples: 1_000,
        bootstrapMethod: "iid",
        walkForwardWindows: 5,
        costSensitivityPoints: 3,
      },
    });
    await updateBacktest(context.userId, row.id, {
      status: "validating",
      validation: {
        validation_job_id: validation.job.job_id,
        job_status: validation.job.status,
      },
      errorMessage: null,
    });
  } catch (error) {
    await updateBacktest(context.userId, row.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      completedAt: Date.now(),
    });
  }
  return getStrategyBacktest(context.userId, row.id);
}

export async function getStrategyDeployment(
  userId: number,
  strategyId: string,
  symbol: string,
  timeframe: string,
): Promise<StrategyDeployment | null> {
  const row = await queryOne<StrategyDeploymentRow>(
    `SELECT * FROM strategy_deployments
      WHERE user_id = ? AND strategy_id = ? AND symbol = ? AND timeframe = ?`,
    [userId, strategyId, symbol.toUpperCase(), timeframe],
  );
  return row ? toDeployment(row) : null;
}

export async function requireRecommendationEvidence(input: {
  userId: number;
  strategyId: string;
  symbol: string;
  timeframe: string;
  claimedBacktestedConfidence: number;
}): Promise<StrategyDeployment> {
  const deployment = await getStrategyDeployment(
    input.userId,
    input.strategyId,
    input.symbol,
    input.timeframe,
  );
  if (!deployment) {
    throw new Error("Strategy has no statistically validated backtest for this symbol and timeframe");
  }
  if (deployment.state === "suspended") {
    throw new Error(deployment.suspendedReason ?? "Strategy is suspended after live performance decay");
  }
  if (
    Math.abs(
      Number(input.claimedBacktestedConfidence) - deployment.calibratedConfidence,
    ) > 0.01
  ) {
    throw new Error(
      `backtested_confidence must equal server evidence (${deployment.calibratedConfidence})`,
    );
  }
  return deployment;
}

interface OutcomeSummaryRow {
  recommendation_id: number;
  status: string;
  outcome_type: string | null;
  pnl: number | null;
}

function resolvedOutcomes(rows: OutcomeSummaryRow[]): boolean[] {
  const grouped = new Map<number, OutcomeSummaryRow[]>();
  for (const row of rows) {
    grouped.set(row.recommendation_id, [
      ...(grouped.get(row.recommendation_id) ?? []),
      row,
    ]);
  }
  const results: boolean[] = [];
  for (const items of grouped.values()) {
    const types = new Set(items.map((item) => item.outcome_type));
    const positivePnl = items.some((item) => Number(item.pnl) > 0);
    const negativePnl = items.some((item) => Number(item.pnl) < 0);
    if (
      items[0]!.status === "tp_hit" ||
      types.has("TP3") ||
      (positivePnl && !negativePnl)
    ) {
      results.push(true);
    } else if (
      items[0]!.status === "sl_hit" ||
      types.has("SL") ||
      (negativePnl && !positivePnl)
    ) {
      results.push(false);
    }
  }
  return results.slice(0, DECAY_SAMPLE_SIZE);
}

export async function refreshStrategyDecay(
  userId: number,
  deployment: StrategyDeployment,
): Promise<{ deployment: StrategyDeployment; event: "promoted" | "suspended" | null }> {
  const rows = await query<OutcomeSummaryRow>(
    `SELECT r.id AS recommendation_id, r.status, o.outcome_type, o.pnl
       FROM recommendations r
       LEFT JOIN recommendation_outcomes o
         ON o.recommendation_id = r.id AND o.user_id = r.user_id
      WHERE r.user_id = ? AND r.strategy_id = ? AND r.symbol = ?
        AND r.timeframe = ? AND r.backtest_id = ?
      ORDER BY r.id DESC, o.id DESC LIMIT 300`,
    [
      userId,
      deployment.strategyId,
      deployment.symbol,
      deployment.timeframe,
      deployment.backtestId,
    ],
  );
  const outcomes = resolvedOutcomes(rows);
  const sampleSize = outcomes.length;
  const liveWinRate = sampleSize
    ? outcomes.filter(Boolean).length / sampleSize
    : null;
  let state = deployment.state;
  let reason = deployment.suspendedReason;
  let event: "promoted" | "suspended" | null = null;
  if (
    sampleSize >= MIN_SHADOW_OUTCOMES &&
    liveWinRate != null &&
    deployment.expectedWinRate - liveWinRate >= MAX_WIN_RATE_DECAY
  ) {
    if (state !== "suspended") event = "suspended";
    state = "suspended";
    reason = `Live win rate ${(liveWinRate * 100).toFixed(1)}% trails backtest ${(deployment.expectedWinRate * 100).toFixed(1)}% by at least ${MAX_WIN_RATE_DECAY * 100} points`;
  } else if (
    state === "shadow" &&
    sampleSize >= MIN_SHADOW_OUTCOMES &&
    liveWinRate != null
  ) {
    state = "active";
    reason = null;
    event = "promoted";
  }
  await execute(
    `UPDATE strategy_deployments
        SET state = ?, live_sample_size = ?, live_win_rate = ?,
            suspended_reason = ?, updated_at = ?
      WHERE user_id = ? AND strategy_id = ? AND symbol = ? AND timeframe = ?`,
    [
      state,
      sampleSize,
      liveWinRate,
      reason,
      Date.now(),
      userId,
      deployment.strategyId,
      deployment.symbol,
      deployment.timeframe,
    ],
  );
  const updated = await getStrategyDeployment(
    userId,
    deployment.strategyId,
    deployment.symbol,
    deployment.timeframe,
  );
  return { deployment: updated ?? deployment, event };
}

export async function refreshAllStrategyDecay(
  userId: number,
): Promise<
  Array<{
    event: "promoted" | "suspended";
    deployment: StrategyDeployment;
  }>
> {
  const rows = await query<StrategyDeploymentRow>(
    "SELECT * FROM strategy_deployments WHERE user_id = ? ORDER BY strategy_id, symbol, timeframe",
    [userId],
  );
  const events: Array<{
    event: "promoted" | "suspended";
    deployment: StrategyDeployment;
  }> = [];
  for (const row of rows) {
    const result = await refreshStrategyDecay(userId, toDeployment(row));
    if (result.event) {
      events.push({ event: result.event, deployment: result.deployment });
    }
  }
  return events;
}

export async function getStrategyPerformance(input: {
  userId: number;
  strategyId: string;
  symbol?: string;
  timeframe?: string;
  context?: ResearchCallerContext;
}): Promise<{
  backtest: StrategyBacktestEvidence | null;
  deployment: StrategyDeployment | null;
}> {
  let backtest = await getLatestStrategyBacktest(
    input.userId,
    input.strategyId,
    input.symbol,
    input.timeframe,
  );
  if (
    backtest &&
    input.context &&
    !["eligible", "ineligible", "failed"].includes(backtest.status)
  ) {
    backtest = await refreshStrategyBacktest(input.context, backtest.id);
  }
  let deployment =
    backtest == null
      ? null
      : await getStrategyDeployment(
          input.userId,
          backtest.strategyId,
          backtest.symbol,
          backtest.timeframe,
        );
  if (deployment) {
    deployment = (await refreshStrategyDecay(input.userId, deployment)).deployment;
  }
  return { backtest, deployment };
}

export async function checkRecommendationExecutionEligibility(input: {
  userId: number;
  recommendationId: number;
  symbol: string;
  side: "buy" | "sell";
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await queryOne<{
    symbol: string;
    action: string;
    strategy_id: string | null;
    timeframe: string | null;
    backtest_id: number | null;
    deployment_state: string | null;
    deployment_backtest_id: number | null;
  }>(
    `SELECT r.symbol, r.action, r.strategy_id, r.timeframe, r.backtest_id,
            d.state AS deployment_state, d.backtest_id AS deployment_backtest_id
       FROM recommendations r
       LEFT JOIN strategy_deployments d
         ON d.user_id = r.user_id AND d.strategy_id = r.strategy_id
        AND d.symbol = r.symbol AND d.timeframe = r.timeframe
      WHERE r.id = ? AND r.user_id = ?`,
    [input.recommendationId, input.userId],
  );
  if (!row) return { ok: false, reason: "Recommendation does not exist for this user" };
  if (row.symbol.toUpperCase() !== input.symbol.toUpperCase() || row.action !== input.side) {
    return { ok: false, reason: "Recommendation symbol or side does not match the order" };
  }
  if (!row.strategy_id || !row.backtest_id) {
    return { ok: false, reason: "Recommendation has no backtest evidence" };
  }
  if (
    row.deployment_state !== "active" ||
    Number(row.deployment_backtest_id) !== Number(row.backtest_id)
  ) {
    return {
      ok: false,
      reason:
        row.deployment_state === "shadow"
          ? "Strategy is still in shadow trading and cannot execute live"
          : "Strategy is not active or its evidence has been superseded",
    };
  }
  return { ok: true };
}
