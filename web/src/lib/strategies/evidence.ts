import { execute, insertReturningId, query, queryOne } from "@/lib/db";
import {
  canonicalStrategySymbol,
  canonicalStrategyTimeframe,
} from "./matchingKeys";
import {
  getResearchJob,
  getResearchJsonArtifact,
} from "@/lib/research/client";
import { formatResearchFailure } from "@/lib/research/serviceErrors";
import {
  buildTransportIncident,
  clearedTransportState,
  isTransportFailure,
} from "@/lib/research/transportState";
import { GENERATED_CATALOG } from "./catalogGen";
import { evaluateSelectionBias } from "./selectionBias";
import { runBacktestValidation } from "@/lib/research/jobs";
import type {
  ResearchArtifactReference,
  ResearchCallerContext,
} from "@/lib/research/types";
import { calibrateBootstrapWinRate } from "./calibration";

export const MIN_BACKTEST_TRADES = 100;

/**
 * How many strategy configurations the factory searches — the "trials" the
 * selection-bias guard corrects for (RELIABILITY_PLAN.md item 18, step 3).
 * Reading it from the live catalog means the bar rises AUTOMATICALLY as the
 * catalog grows, which is precisely the protection the plan requires before
 * any expansion.
 */
function catalogTrialCount(): number {
  return Math.max(1, GENERATED_CATALOG.length);
}
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
 * Bootstrap (IID) 90% CI on the observed win rate (Wilson fallback for tiny n).
 * Stored as 0–100 percentages to match deployment / recommendation gates.
 */
export function calibrateObservedWinRate(
  tradeCount: number,
  rawWinRate: number,
): CalibratedConfidence {
  const wins = Math.max(0, Math.round(Math.max(0, Math.min(1, rawWinRate)) * tradeCount));
  const calibrated = calibrateBootstrapWinRate({
    wins,
    samples: tradeCount,
    iterations: 2_000,
    seed: 42,
    confidenceLevel: 0.9,
    minTradesForCalibration: 30,
  });
  return {
    confidence: Math.round(calibrated.winRate * 10_000) / 100,
    low: Math.round(calibrated.confidenceLow * 10_000) / 100,
    high: Math.round(calibrated.confidenceHigh * 10_000) / 100,
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
  const validationRef = artifact(job.artifact_refs, "validation.json");
  const validationSuite = validationRef
    ? await getResearchJsonArtifact(
        context,
        validationJobId,
        validationRef.artifact_id,
      )
    : null;
  const walkForward =
    validationSuite &&
    typeof validationSuite === "object" &&
    validationSuite.walk_forward &&
    typeof validationSuite.walk_forward === "object"
      ? (validationSuite.walk_forward as Record<string, unknown>)
      : null;
  const bootstrap =
    validationSuite &&
    typeof validationSuite === "object" &&
    validationSuite.bootstrap &&
    typeof validationSuite.bootstrap === "object"
      ? (validationSuite.bootstrap as Record<string, unknown>)
      : null;

  // Prefer research-service bootstrap win-rate CI when present.
  let calibratedUpdate: CalibratedConfidence | null = null;
  const intervals = Array.isArray(bootstrap?.intervals) ? bootstrap.intervals : [];
  const winRateInterval = intervals.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { metric?: string }).metric === "win_rate",
  ) as { lower?: unknown; upper?: unknown; observed?: unknown } | undefined;
  if (
    winRateInterval &&
    typeof winRateInterval.lower === "number" &&
    typeof winRateInterval.upper === "number"
  ) {
    const observed =
      typeof winRateInterval.observed === "number"
        ? winRateInterval.observed
        : row.win_rate ?? 0;
    calibratedUpdate = {
      confidence:
        Math.round(Math.max(0, Math.min(1, observed)) * 10_000) / 100,
      low: Math.round(Math.max(0, Math.min(1, winRateInterval.lower)) * 10_000) / 100,
      high: Math.round(Math.max(0, Math.min(1, winRateInterval.upper)) * 10_000) / 100,
    };
  }

  const readinessStatus = String(readiness.readiness_status ?? "rejected");
  const failedGates = Array.isArray(readiness.failed_gates)
    ? readiness.failed_gates.map(String)
    : [];
  const overfit =
    walkForward?.likely_overfit === true ||
    failedGates.some((gate) => gate.toLowerCase().includes("overfitting"));
  // Selection-bias guard (RELIABILITY_PLAN.md item 18, step 3). This strategy
  // was not tested in isolation — it was SELECTED out of a whole catalog, so
  // its Sharpe must clear the bar that luck alone produces across that many
  // trials. Without this, a bigger catalog manufactures false discoveries
  // instead of finding edge. It can only ever REJECT; it never promotes.
  // The stored Sharpe is ANNUALIZED per bar (research-service metrics.py), so
  // it is de-annualized inside the guard and compared against the bar count it
  // was computed over — never the trade count. Mixing those scales would make
  // the gate pass everything while appearing to protect the operator.
  const storedMetricsBlob = jsonObject(row.metrics_json);
  const nestedMetrics =
    storedMetricsBlob.metrics && typeof storedMetricsBlob.metrics === "object"
      ? (storedMetricsBlob.metrics as Record<string, unknown>)
      : {};
  const barsInDataset = finite(
    nestedMetrics.bars_in_dataset ?? storedMetricsBlob.bars_in_dataset,
  );
  const selection = evaluateSelectionBias({
    sharpeRatio: row.sharpe_ratio,
    timeframe: row.timeframe,
    observationCount: barsInDataset,
    trials: catalogTrialCount(),
  });

  const eligible =
    READY_FOR_SHADOW.has(readinessStatus) &&
    readiness.live_trading_authorized === false &&
    !overfit &&
    selection.passes;
  await updateBacktest(context.userId, row.id, {
    status: eligible ? "eligible" : "ineligible",
    ...(calibratedUpdate ? { calibrated: calibratedUpdate } : {}),
    validation: {
      ...validationState,
      job_status: job.status,
      readiness,
      readiness_artifact_id: readinessRef.artifact_id,
      walk_forward: walkForward,
      selection_bias: selection,
      bootstrap_summary: bootstrap
        ? {
            method: bootstrap.method,
            simulations: bootstrap.simulations,
            confidence: bootstrap.confidence,
            observations: bootstrap.observations,
            intervals: bootstrap.intervals,
          }
        : null,
    },
    errorMessage: eligible
      ? null
      : overfit
        ? "Readiness gate: walk-forward overfitting risk"
        : !selection.passes
          ? `Selection-bias gate: ${selection.reason}`
          : `Readiness gate: ${readinessStatus}`,
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
  // Terminal success/rejection stays cached. Failed rows may be retried when the
  // Research job actually succeeded (e.g. after deploying missing artifact APIs).
  if (["eligible", "ineligible"].includes(row.status)) return toEvidence(row);

  try {
    if (row.status === "validating") {
      await finalizeValidation(context, row, jsonObject(row.validation_json));
      return getStrategyBacktest(context.userId, row.id);
    }

    const job = await getResearchJob(context, row.job_id);
    // Reachable again: replace any assumed state with the authoritative one and
    // clear the transport incident (RELIABILITY_PLAN.md item 4).
    const priorValidation = jsonObject(row.validation_json);
    const hadTransportIncident =
      priorValidation.transport_state !== undefined &&
      priorValidation.transport_state !== "ok";
    if (["queued", "running", "retry_wait", "cancelling"].includes(job.status)) {
      await updateBacktest(context.userId, row.id, {
        status: job.status === "queued" ? "pending" : "running",
        ...(hadTransportIncident
          ? {
              validation: { ...priorValidation, ...clearedTransportState() },
              errorMessage: null,
            }
          : {}),
      });
      return getStrategyBacktest(context.userId, row.id);
    }
    if (job.status !== "succeeded") {
      const detail = [
        job.error_message,
        job.error_code ? `code=${job.error_code}` : null,
        `job_status=${job.status}`,
      ]
        .filter(Boolean)
        .join(" | ");
      await updateBacktest(context.userId, row.id, {
        status: "failed",
        errorMessage: detail || `Backtest ${job.status}`,
        completedAt: Date.now(),
      });
      return getStrategyBacktest(context.userId, row.id);
    }

    if (row.status === "failed") {
      await updateBacktest(context.userId, row.id, {
        status: "running",
        errorMessage: null,
        completedAt: null,
      });
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
    const wins = Math.max(0, Math.round(winRate * tradeCount));
    const bootstrapCalibration = calibrateBootstrapWinRate({
      wins,
      samples: tradeCount,
      iterations: 2_000,
      seed: 42,
      confidenceLevel: 0.9,
      minTradesForCalibration: Math.min(MIN_BACKTEST_TRADES, 30),
    });
    const calibrated: CalibratedConfidence = {
      confidence: Math.round(bootstrapCalibration.winRate * 10_000) / 100,
      low: Math.round(bootstrapCalibration.confidenceLow * 10_000) / 100,
      high: Math.round(bootstrapCalibration.confidenceHigh * 10_000) / 100,
    };
    const storedMetrics = {
      ...jsonObject(row.metrics_json),
      metrics,
      bars_in_dataset: metrics.bars_in_dataset ?? null,
      bars_evaluated: metrics.bars_evaluated ?? null,
      confidence_calibration: bootstrapCalibration,
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
    // Transport failure is NOT job failure (RELIABILITY_PLAN.md item 4).
    // Losing the connection tells us nothing about the job: the production
    // incident this guards against is a polling timeout marking LIVE jobs
    // "failed". Only an explicit terminal verdict from the service may do that.
    if (isTransportFailure(error)) {
      const previous = jsonObject(row.validation_json);
      const incident = buildTransportIncident(
        Number(previous.poll_failures ?? 0),
        error,
      );
      await updateBacktest(context.userId, row.id, {
        // Status deliberately UNCHANGED — the job keeps its last known state.
        validation: { ...previous, ...incident },
        errorMessage: incident.note,
        // No completedAt: the job is not finished, we simply cannot see it.
      });
    } else {
      await updateBacktest(context.userId, row.id, {
        status: "failed",
        errorMessage: formatResearchFailure(error),
        completedAt: Date.now(),
      });
    }
  }
  return getStrategyBacktest(context.userId, row.id);
}

export async function getStrategyDeployment(
  userId: number,
  strategyId: string,
  symbol: string,
  timeframe: string,
): Promise<StrategyDeployment | null> {
  // Canonicalise the matching keys: deployments store XAUUSD/1h while callers
  // may hold broker-suffixed symbols (XAUUSDM) or alias timeframes ("H1").
  const canonicalTimeframe = canonicalStrategyTimeframe(timeframe);
  if (!canonicalTimeframe) return null;
  const row = await queryOne<StrategyDeploymentRow>(
    `SELECT * FROM strategy_deployments
      WHERE user_id = ? AND strategy_id = ? AND symbol = ? AND timeframe = ?`,
    [userId, strategyId, canonicalStrategySymbol(symbol), canonicalTimeframe],
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
  // Batched: with a mass-backtest catalog the deployment count can reach
  // hundreds. Oldest-refreshed first, 200 per 10-min monitor tick — full
  // coverage within the hour without stretching the cron invocation.
  const rows = await query<StrategyDeploymentRow>(
    `SELECT * FROM strategy_deployments WHERE user_id = ?
      ORDER BY updated_at ASC, strategy_id, symbol, timeframe LIMIT 200`,
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
    !["eligible", "ineligible"].includes(backtest.status)
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
  }>(
    `SELECT r.symbol, r.action, r.strategy_id, r.timeframe, r.backtest_id
       FROM recommendations r
      WHERE r.id = ? AND r.user_id = ?`,
    [input.recommendationId, input.userId],
  );
  if (!row) return { ok: false, reason: "Recommendation does not exist for this user" };
  // Compare canonical symbols so a broker-suffixed order (XAUUSDM) matches a
  // canonically stored recommendation (XAUUSD) and vice versa for legacy rows.
  if (
    canonicalStrategySymbol(row.symbol) !== canonicalStrategySymbol(input.symbol) ||
    row.action !== input.side
  ) {
    return { ok: false, reason: "Recommendation symbol or side does not match the order" };
  }
  if (!row.strategy_id || !row.backtest_id) {
    return { ok: false, reason: "Recommendation has no backtest evidence" };
  }
  // Deployment lookup goes through the canonicalising helper instead of a raw
  // SQL join, so legacy suffixed/alias recommendation rows still resolve.
  const deployment = await getStrategyDeployment(
    input.userId,
    row.strategy_id,
    row.symbol,
    row.timeframe ?? "",
  );
  if (
    deployment?.state !== "active" ||
    Number(deployment.backtestId) !== Number(row.backtest_id)
  ) {
    return {
      ok: false,
      reason:
        deployment?.state === "shadow"
          ? "Strategy is still in shadow trading and cannot execute live"
          : "Strategy is not active or its evidence has been superseded",
    };
  }
  return { ok: true };
}
