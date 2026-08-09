import {
  QUANT_BOT_DEFAULT_EXECUTION_MODE,
  isQuantBotExecutionMode,
} from "./bots/brokerPort";
import { QuantAgentServiceError } from "./errors";
import {
  isTransientQuantAgentError,
  quantAgentHttpError,
  type ServiceErrorBody,
} from "./serviceErrors";
import type {
  CreateQuantBotParams,
  PreviewQuantBotParams,
  QuantBot,
  QuantBotExecutionModeWire,
  QuantBotLevel,
  QuantBotLevelWire,
  QuantBotPreview,
  QuantBotPreviewWire,
  QuantBotRiskDiagnostic,
  QuantBotRun,
  QuantBotRunWire,
  QuantBotSimulation,
  QuantBotSimulationWire,
  QuantBotWire,
  SetQuantBotExecutionModeParams,
  SimulateQuantBotParams,
} from "./bots/types";
import type {
  BacktestQuantStrategyParams,
  FinalizeQuantAnalysisParams,
  GenerateQuantRecommendationInput,
  GenerateQuantStrategyCodeParams,
  GenerateValidateQuantStrategyResult,
  GeneratedQuantStrategyRecord,
  GeneratedStrategySpec,
  ListQuantRecommendationsParams,
  QuantAgentCallerContext,
  QuantAnalysisFinalizeResult,
  QuantAnalysisScoreResult,
  QuantAnalysisScoreResultWire,
  QuantBacktestResult,
  QuantBacktestResultWire,
  QuantOhlcBar,
  QuantRecommendation,
  QuantRecommendationWire,
  QuantStrategyDef,
  ScoreQuantAnalysisParams,
  QuantStrategyStatus,
} from "./types";

if (typeof window !== "undefined") {
  throw new Error("Quant Agent Service client is server-only");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mirrors researchServiceEnabled() — web/src/lib/research/client.ts. */
export function quantAgentServiceEnabled(): boolean {
  return process.env.QUANT_AGENT_SERVICE_ENABLED === "1";
}

function requireQuantAgentServiceEnabled(): void {
  if (!quantAgentServiceEnabled()) {
    throw new QuantAgentServiceError(
      "QUANT_AGENT_SERVICE_DISABLED",
      "Quant Agent Service is disabled",
      503,
    );
  }
}

function clientTimeoutMs(): number {
  const configured = Number(process.env.QUANT_AGENT_SERVICE_CLIENT_TIMEOUT_MS || 10_000);
  return Number.isFinite(configured) ? Math.min(30_000, Math.max(100, configured)) : 10_000;
}

/**
 * Backtests get their own, much larger ceiling.
 *
 * `clientTimeoutMs` is hard-capped at 30s, which is right for the ordinary
 * request/response calls in this file but is BELOW what the backtest endpoint
 * is allowed to take: the service's own `backtest_batch_timeout_seconds`
 * defaults to 90 and is settable up to 300. Sharing the global value means the
 * client aborts a run the server is still legitimately working on, and the
 * wizard reports a timeout for a backtest that would have produced real
 * numbers — the caller giving up before the callee's own deadline is never a
 * correct pairing.
 *
 * Override with QUANT_AGENT_BACKTEST_CLIENT_TIMEOUT_MS. Floor is the global
 * value (never shorter than an ordinary call), ceiling 300s to match the
 * service's own maximum.
 */
function backtestTimeoutMs(): number {
  const configured = Number(process.env.QUANT_AGENT_BACKTEST_CLIENT_TIMEOUT_MS || 120_000);
  const resolved = Number.isFinite(configured) ? configured : 120_000;
  return Math.min(300_000, Math.max(clientTimeoutMs(), resolved));
}

/**
 * The analysis endpoints get their own ceiling, for the opposite reason
 * to the backtest one.
 *
 * `/analysis/score` and `/analysis/finalize` are pure arithmetic over a
 * handful of pushed timeframes — milliseconds of real work — but they sit in
 * the middle of an interactive request that has already spent its budget on
 * candle collection and one LLM call. The global 30s cap is the wrong shape
 * for both ends: too tight if the service is cold-starting behind the pm2
 * ingress proxy, and far too generous as a "still working" signal. A separate
 * knob lets an operator tune the analysis path without also lengthening every
 * ordinary recommendation call.
 *
 * Override with QUANT_AGENT_ANALYSIS_CLIENT_TIMEOUT_MS. Floor is the global
 * value (never shorter than an ordinary call), ceiling 120s.
 */
function analysisTimeoutMs(): number {
  const configured = Number(process.env.QUANT_AGENT_ANALYSIS_CLIENT_TIMEOUT_MS || 45_000);
  const resolved = Number.isFinite(configured) ? configured : 45_000;
  return Math.min(120_000, Math.max(clientTimeoutMs(), resolved));
}

function serviceConfig(): { url: string; token: string } {
  requireQuantAgentServiceEnabled();
  const url = process.env.QUANT_AGENT_SERVICE_URL?.trim().replace(/\/$/, "");
  const token = process.env.QUANT_AGENT_SERVICE_INTERNAL_TOKEN?.trim();
  if (!url || !token || token.length < 16) {
    throw new QuantAgentServiceError(
      "QUANT_AGENT_SERVICE_CONFIG_INVALID",
      "Quant Agent Service server configuration is incomplete",
      503,
    );
  }
  return { url, token };
}

/** Per-call overrides. Omitted fields keep this file's ordinary behaviour. */
interface ServiceRequestOptions {
  /** Abort deadline for this one call. Defaults to `clientTimeoutMs()`. */
  timeoutMs?: number;
  /**
   * Whether a timeout is worth one automatic retry. True for cheap calls; set
   * false for anything long-running, where retrying doubles the worst-case
   * wall clock for work that already had its full deadline.
   */
  retryOnTimeout?: boolean;
}

async function serviceRequestOnce<T>(
  context: QuantAgentCallerContext,
  path: string,
  init: RequestInit = {},
  options: ServiceRequestOptions = {},
): Promise<T> {
  if (!Number.isInteger(context.userId) || context.userId <= 0 || !context.requestId) {
    throw new QuantAgentServiceError("QUANT_AGENT_SERVICE_ERROR", "Invalid tenant context", 400);
  }
  const { url, token } = serviceConfig();
  const timeoutMs = options.timeoutMs ?? clientTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-AiChart-Caller": "aichart-web",
        "X-AiChart-User-Id": String(context.userId),
        "X-AiChart-Request-Id": context.requestId,
        ...init.headers,
      },
    });
    if (response.status === 204) {
      return null as T;
    }
    const body = (await response.json().catch(() => ({}))) as T & ServiceErrorBody;
    if (!response.ok) {
      throw quantAgentHttpError(response.status, body, path);
    }
    return body;
  } catch (error) {
    if (error instanceof QuantAgentServiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new QuantAgentServiceError(
        "QUANT_AGENT_SERVICE_TIMEOUT",
        `Quant Agent Service request timed out after ${timeoutMs}ms (path=${path})`,
        504,
      );
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new QuantAgentServiceError(
      "QUANT_AGENT_SERVICE_UNAVAILABLE",
      `Quant Agent Service connection error: ${cause} (path=${path})`,
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One automatic retry for transient timeout / connection failures — same
 * policy as the research client.
 */
async function serviceRequest<T>(
  context: QuantAgentCallerContext,
  path: string,
  init: RequestInit = {},
  options: ServiceRequestOptions = {},
): Promise<T> {
  try {
    return await serviceRequestOnce<T>(context, path, init, options);
  } catch (error) {
    if (!isTransientQuantAgentError(error)) throw error;
    if (
      options.retryOnTimeout === false &&
      error instanceof QuantAgentServiceError &&
      error.code === "QUANT_AGENT_SERVICE_TIMEOUT"
    ) {
      throw error;
    }
    await sleep(250);
    return serviceRequestOnce<T>(context, path, init, options);
  }
}

function parseJsonMaybe<T>(value: string | T | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Decodes the wire recommendation (targets_json/targets, evidence_json/evidence). */
export function normalizeQuantRecommendation(raw: QuantRecommendationWire): QuantRecommendation {
  const targets = Array.isArray(raw.targets)
    ? raw.targets
    : parseJsonMaybe<number[]>(raw.targets_json, []);
  const evidence =
    raw.evidence && typeof raw.evidence === "object"
      ? raw.evidence
      : parseJsonMaybe<Record<string, unknown>>(raw.evidence_json, {});
  return {
    id: raw.id,
    owner_user_id: raw.owner_user_id,
    symbol: raw.symbol,
    market: raw.market,
    interval: raw.interval,
    direction: raw.direction,
    plan_type: raw.plan_type,
    entry: raw.entry ?? null,
    stop_loss: raw.stop_loss,
    take_profit: raw.take_profit ?? null,
    targets: Array.isArray(targets) ? targets : [],
    confidence: raw.confidence,
    strategy_id: raw.strategy_id,
    strategy_version: raw.strategy_version,
    regime: raw.regime ?? null,
    rationale: raw.rationale,
    evidence: evidence && typeof evidence === "object" ? evidence : {},
    validity_expires_at: raw.validity_expires_at ?? null,
    lifecycle_state: raw.lifecycle_state,
    source_bar_close_time: raw.source_bar_close_time,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

/**
 * Decodes a POST /recommendations response that may legitimately be "no
 * signal" — a null body, an empty object, or `{ recommendation: null }` — all
 * of which mean the strategies found nothing to propose this tick, not a
 * failure (§3: "لا إشارة من أي منهما → الخدمة تُرجع لا إشارة").
 */
function normalizeGeneratedRecommendation(
  raw: QuantRecommendationWire | { recommendation: QuantRecommendationWire | null } | null,
): QuantRecommendation | null {
  if (!raw) return null;
  const candidate =
    "recommendation" in raw ? (raw as { recommendation: QuantRecommendationWire | null }).recommendation : raw;
  if (!candidate || typeof candidate !== "object" || !("id" in candidate) || !candidate.id) {
    return null;
  }
  return normalizeQuantRecommendation(candidate as QuantRecommendationWire);
}

/** Read-only strategy catalog — used for display, never to gate generation. */
export async function listQuantAgentStrategies(
  context: QuantAgentCallerContext,
): Promise<QuantStrategyDef[]> {
  const result = await serviceRequest<QuantStrategyDef[] | { strategies: QuantStrategyDef[] }>(
    context,
    "/internal/quant-agent/strategies",
  );
  return Array.isArray(result) ? result : (result.strategies ?? []);
}

/**
 * The one place a `QuantOhlcBar` becomes the service's wire `Bar`.
 *
 * `QuantOhlcBar.time` is epoch milliseconds everywhere on this side; the
 * service declares `time: str` (ISO 8601) and pydantic does not coerce an int
 * into a str, so sending the raw bar is a hard HTTP 422 — not a soft
 * mismatch. Both callers go through this function specifically so they cannot
 * drift: the backtest path converted correctly while the recommendation path
 * passed `input.bars` straight through, which meant the recommendation
 * endpoint had never once succeeded from web. It stayed invisible because
 * both crons skip the call entirely when the feed returns no bars, so the
 * request was only ever built once real candles existed.
 */
interface ServiceBar {
  /** ISO 8601. The service's `Bar.time` is a str, not an epoch number. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

function toServiceBars(bars: QuantOhlcBar[]): ServiceBar[] {
  return bars.map((bar) => ({
    time: new Date(bar.time).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? null,
  }));
}

/**
 * Assembles candles are pushed here (§2 — web gathers, quant-agent decides).
 * Returns null on "no signal", never throws for that case.
 */
export async function generateQuantRecommendation(
  context: QuantAgentCallerContext,
  input: GenerateQuantRecommendationInput,
): Promise<QuantRecommendation | null> {
  const raw = await serviceRequest<
    QuantRecommendationWire | { recommendation: QuantRecommendationWire | null } | null
  >(context, "/internal/quant-agent/recommendations", {
    method: "POST",
    body: JSON.stringify({
      symbol: input.symbol,
      market: input.market,
      interval: input.interval,
      bars: toServiceBars(input.bars),
      owner_user_id: context.userId,
      request_id: context.requestId,
    }),
  });
  return normalizeGeneratedRecommendation(raw);
}

export async function listQuantRecommendations(
  context: QuantAgentCallerContext,
  params: ListQuantRecommendationsParams = {},
): Promise<QuantRecommendation[]> {
  const qs = new URLSearchParams();
  if (params.symbol) qs.set("symbol", params.symbol);
  if (params.state) qs.set("state", params.state);
  const suffix = qs.toString();
  const path = `/internal/quant-agent/recommendations${suffix ? `?${suffix}` : ""}`;
  const raw = await serviceRequest<QuantRecommendationWire[] | { recommendations: QuantRecommendationWire[] }>(
    context,
    path,
  );
  const list = Array.isArray(raw) ? raw : (raw.recommendations ?? []);
  return list.map(normalizeQuantRecommendation);
}

/**
 * Quant Agent Chat's `generate_strategy` flow (plan §3/§5). Sends a
 * declarative strategy specification the LLM drafted to the quant-agent
 * service for pydantic validation — no `eval`/`exec` anywhere, and the
 * service is the only thing that decides whether it gets persisted. On
 * success the row is stored `enabled=false, source_generated=true`; on
 * failure nothing is written and `errors` describes exactly what to fix.
 * Mirrors `generateQuantRecommendation`'s request/error-handling shape
 * exactly (same `QuantAgentServiceError` / transient-retry path via
 * `serviceRequest`).
 */
export async function generateAndValidateQuantStrategy(
  context: QuantAgentCallerContext,
  spec: GeneratedStrategySpec | Record<string, unknown>,
): Promise<GenerateValidateQuantStrategyResult> {
  return serviceRequest<GenerateValidateQuantStrategyResult>(
    context,
    "/internal/quant-agent/strategies/generate-validate",
    {
      method: "POST",
      // The owner is set at creation, not patched on later: an ownerless
      // generated strategy is either everyone's or no one's.
      body: JSON.stringify({ spec, owner_user_id: context.userId }),
    },
  );
}

/**
 * Quant Agent Chat's sandboxed-code `generate_strategy` flow (plan §4/§5 —
 * the chat intent's now-default mechanism, matching QuantDinger technically).
 * Sends `evaluate(features)` Python the LLM drafted to the quant-agent
 * service, which runs the full regex/AST safety check plus an isolated-
 * subprocess compile/discovery pass before ever persisting it — no `eval`/
 * `exec` here in `web/`, and the service alone decides whether it gets
 * stored. On success the row is `enabled=false, generation_mode:
 * "sandboxed_code"`; on failure nothing is written and `errors` describes
 * exactly what to fix. Mirrors `generateAndValidateQuantStrategy`'s request/
 * error-handling shape exactly (same `serviceRequest` call, same
 * `QuantAgentServiceError` / transient-retry path).
 */
export async function generateAndValidateQuantStrategyCode(
  context: QuantAgentCallerContext,
  params: GenerateQuantStrategyCodeParams,
): Promise<GenerateValidateQuantStrategyResult> {
  return serviceRequest<GenerateValidateQuantStrategyResult>(
    context,
    "/internal/quant-agent/strategies/generate-validate-code",
    {
      method: "POST",
      body: JSON.stringify({
        owner_user_id: context.userId,
        strategy_id: params.strategyId,
        version: params.version,
        display_name: params.displayName,
        description: params.description,
        regime_affinity: params.regimeAffinity,
        code: params.code,
      }),
    },
  );
}

/**
 * Moves one of the caller's OWN generated strategies through its lifecycle.
 *
 * The service checks ownership against the stored row and answers 404 for
 * every refusal — not yours, not generated, no such id — so this cannot be
 * used to enumerate other people's strategies or to touch a built-in.
 *
 * This replaced an admin-only enable toggle. That restriction existed because
 * the registry loaded every enabled generated strategy for every user, so one
 * owner enabling their own put their LLM-written Python into strangers'
 * recommendations. The registry is scoped per owner now, which is what makes
 * self-service safe rather than merely convenient.
 */
export async function setQuantStrategyStatus(
  context: QuantAgentCallerContext,
  strategyId: string,
  status: QuantStrategyStatus,
): Promise<{ strategy: GeneratedQuantStrategyRecord }> {
  return serviceRequest<{ strategy: GeneratedQuantStrategyRecord }>(
    context,
    `/internal/quant-agent/strategies/${encodeURIComponent(strategyId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status, owner_user_id: context.userId }),
    },
  );
}

/** Decodes the wire backtest metrics/result (trade_count/win_rate/... → camelCase). */
export function normalizeQuantBacktestResult(raw: QuantBacktestResultWire): QuantBacktestResult {
  const rawMetrics = raw.metrics;
  return {
    status: raw.status,
    metrics: rawMetrics
      ? {
          tradeCount: rawMetrics.trade_count,
          winRate: rawMetrics.win_rate ?? null,
          profitFactor: rawMetrics.profit_factor ?? null,
          expectancyR: rawMetrics.expectancy_r ?? null,
          maxDrawdownR: rawMetrics.max_drawdown_r ?? null,
          maxDrawdownPercent: rawMetrics.max_drawdown_percent ?? null,
          sharpeR: rawMetrics.sharpe_r ?? null,
          metricReasons: rawMetrics.metric_reasons ?? {},
        }
      : null,
    warnings: raw.warnings ?? null,
    error: raw.error ?? null,
  };
}

/**
 * Quant Agent Chat's bounded backtest quality-gate loop (chat wizard only —
 * plan §4/§5). POSTs the strategy's own historical bars to quant-agent's
 * isolated backtest engine (single subprocess for the whole batch, never the
 * live per-candle sandbox path) and reads back R-multiple performance
 * metrics. Bars go through `toServiceBars`, shared with the recommendation
 * call so the epoch-ms → ISO conversion cannot be applied to one and not the
 * other. Mirrors every other function in
 * this file: same `serviceRequest` call, same `QuantAgentServiceError` path.
 * It differs in exactly one way — its own timeout, because this is the only
 * call whose server-side deadline exceeds the 30s global cap.
 */
export async function backtestQuantStrategy(
  context: QuantAgentCallerContext,
  params: BacktestQuantStrategyParams,
): Promise<QuantBacktestResult> {
  const raw = await serviceRequest<QuantBacktestResultWire>(
    context,
    `/internal/quant-agent/strategies/${encodeURIComponent(params.strategyId)}/backtest`,
    {
      method: "POST",
      body: JSON.stringify({
        bars: toServiceBars(params.bars),
        symbol: params.symbol,
        market: params.market,
        interval: params.interval,
        owner_user_id: context.userId,
        request_id: context.requestId,
      }),
    },
    // Its own deadline, not the 30s-capped global one — see backtestTimeoutMs.
    // No timeout retry: the run already had its full budget, and a second
    // attempt would double the wizard's worst case for the same work. A
    // connection-level failure is still retried once, as everywhere else.
    { timeoutMs: backtestTimeoutMs(), retryOnTimeout: false },
  );
  return normalizeQuantBacktestResult(raw);
}

/** Decodes the wire analysis score result (objective_by_timeframe/... → camelCase). */
export function normalizeQuantAnalysisScore(
  raw: QuantAnalysisScoreResultWire,
): QuantAnalysisScoreResult {
  const objectiveByTimeframe: QuantAnalysisScoreResult["objectiveByTimeframe"] = {};
  for (const [timeframe, objective] of Object.entries(raw.objective_by_timeframe ?? {})) {
    objectiveByTimeframe[timeframe] = {
      technicalScore: objective.technical_score ?? null,
      fundamentalScore: objective.fundamental_score ?? null,
      sentimentScore: objective.sentiment_score ?? null,
      macroScore: objective.macro_score ?? null,
      overallScore: objective.overall_score,
      decision: objective.decision,
      absScore: objective.abs_score,
    };
  }
  const consensus = raw.consensus;
  const quality = raw.data_quality;
  return {
    objectiveByTimeframe,
    consensus: {
      decision: consensus.decision,
      score: consensus.score,
      agreement: consensus.agreement,
      timeframeCount: consensus.timeframe_count,
      votes: consensus.votes ?? {},
      weightedScore: consensus.weighted_score,
    },
    trendOutlook: raw.trend_outlook,
    similarPatterns: (raw.similar_patterns ?? []).map((pattern) => ({
      id: pattern.id,
      similarityScore: pattern.similarity_score,
      decision: pattern.decision,
      wasCorrect: pattern.was_correct,
    })),
    dataQuality: {
      degraded: quality?.degraded ?? false,
      confidencePenalty: quality?.confidence_penalty ?? 0,
      missing: quality?.missing ?? [],
    },
  };
}

/**
 * Pre-LLM half of the analysis engine (Wave 1 contract). Pushes the collected
 * per-timeframe indicator snapshots and gets back every rule-side number:
 * the objective scores, the multi-timeframe consensus, the trend outlook and
 * the similar-pattern matches. quant-agent computes all of it because it has
 * no network of its own — web collects, quant-agent decides.
 *
 * `fundamental`/`news`/`macro`/`crypto_factors` are sent as explicit `null`
 * because no source for them exists on this platform. Upstream already
 * weights over PRESENT components only, so an absent component is a real,
 * supported state — never a fabricated 50.
 */
/*
 * Note on the two analysis bodies below: unlike every other call in this file
 * they do NOT carry `owner_user_id` / `request_id`. Both analysis request
 * envelopes are declared `extra="forbid"` on the service side, so those two
 * keys are a hard 422 rather than harmless redundancy. The tenant context
 * still travels — `serviceRequestOnce` puts it in the `X-AiChart-User-Id` and
 * `X-AiChart-Request-Id` headers on every request.
 */
export async function scoreQuantAnalysis(
  context: QuantAgentCallerContext,
  params: ScoreQuantAnalysisParams,
): Promise<QuantAnalysisScoreResult> {
  const raw = await serviceRequest<QuantAnalysisScoreResultWire>(
    context,
    "/internal/quant-agent/analysis/score",
    {
      method: "POST",
      body: JSON.stringify({
        market: params.market,
        symbol: params.symbol,
        primary_timeframe: params.primaryTimeframe,
        current_price: params.currentPrice,
        timeframes: params.timeframes,
        fundamental: null,
        news: null,
        macro: null,
        crypto_factors: null,
        memory_candidates: params.memoryCandidates,
      }),
    },
    // Its own deadline — see analysisTimeoutMs. No timeout retry: this
    // endpoint is pure arithmetic, so a request that ran past a 45s budget
    // means the service is wedged, not flaky, and a second attempt would only
    // double the wait a user is already sitting through.
    { timeoutMs: analysisTimeoutMs(), retryOnTimeout: false },
  );
  return normalizeQuantAnalysisScore(raw);
}

/**
 * Post-LLM half of the analysis engine (Wave 1 contract). Hands the model's
 * raw parsed output to quant-agent's validator, which owns the ±10% entry
 * clamp, the direction-consistent stop/target geometry, the indicator veto
 * and the consensus override. Web never adjusts a level itself — the whole
 * point of the split is that one side computes numbers and the other side
 * never invents them.
 */
export async function finalizeQuantAnalysis(
  context: QuantAgentCallerContext,
  params: FinalizeQuantAnalysisParams,
): Promise<QuantAnalysisFinalizeResult> {
  return serviceRequest<QuantAnalysisFinalizeResult>(
    context,
    "/internal/quant-agent/analysis/finalize",
    {
      method: "POST",
      body: JSON.stringify({
        market: params.market,
        symbol: params.symbol,
        current_price: params.currentPrice,
        indicators: params.indicators,
        llm_output: params.llmOutput,
        has_major_news: params.hasMajorNews,
        has_macro_event: params.hasMacroEvent,
        consensus: {
          decision: params.consensus.decision,
          score: params.consensus.score,
          agreement: params.consensus.agreement,
          timeframe_count: params.consensus.timeframeCount,
          votes: params.consensus.votes,
          weighted_score: params.consensus.weightedScore,
        },
        data_quality: params.dataQuality
          ? {
              degraded: params.dataQuality.degraded,
              confidence_penalty: params.dataQuality.confidencePenalty,
              missing: params.dataQuality.missing,
            }
          : null,
      }),
    },
    { timeoutMs: analysisTimeoutMs(), retryOnTimeout: false },
  );
}

/* ------------------------------------------------------------------
 * Outcome validation + threshold calibration (Wave 2).
 *
 * Unlike the score/finalize shapes, these request and response types live in
 * THIS file rather than in `types.ts`. `types.ts` carries the frozen Wave-1
 * analysis contract that the UI and the API routes both compile against;
 * nothing outside this module and the validation cron ever names a validation
 * payload, so it stays local — the same call `ServiceBar` makes above.
 * ------------------------------------------------------------------ */

/** One aged analysis plus the price it actually reached. */
export interface QuantAnalysisValidationCandidate {
  id: string;
  decision: string;
  priceAtAnalysis: number;
  currentPrice: number;
}

export interface QuantAnalysisValidationOutcome {
  id: string;
  wasCorrect: boolean;
  returnPct: number;
}

export interface QuantAnalysisValidationResult {
  results: QuantAnalysisValidationOutcome[];
  skipped: { id: string; reason: string }[];
  stats: { validated: number; correct: number; incorrect: number; skipped: number };
}

interface QuantAnalysisValidationResultWire {
  results: { id: string; was_correct: boolean; return_pct: number }[];
  skipped: { id: string; reason: string }[];
  stats: { validated: number; correct: number; incorrect: number; skipped: number };
}

/**
 * Scores stored analyses against the price they actually reached.
 *
 * quant-agent owns the ±2%/±5% correctness rule because it owns every other
 * threshold in this engine; web owns the price lookup because quant-agent has
 * no network. Nothing is decided here — the caller writes back exactly what
 * comes out, and a row the service declines to score (non-positive price)
 * comes back under `skipped` rather than as a fabricated 0% move.
 */
export async function validateQuantAnalyses(
  context: QuantAgentCallerContext,
  analyses: QuantAnalysisValidationCandidate[],
): Promise<QuantAnalysisValidationResult> {
  const raw = await serviceRequest<QuantAnalysisValidationResultWire>(
    context,
    "/internal/quant-agent/analysis/validate",
    {
      method: "POST",
      body: JSON.stringify({
        analyses: analyses.map((analysis) => ({
          id: analysis.id,
          decision: analysis.decision,
          price_at_analysis: analysis.priceAtAnalysis,
          current_price: analysis.currentPrice,
        })),
      }),
    },
    { timeoutMs: analysisTimeoutMs(), retryOnTimeout: false },
  );
  return {
    results: (raw.results ?? []).map((outcome) => ({
      id: outcome.id,
      wasCorrect: outcome.was_correct,
      returnPct: outcome.return_pct,
    })),
    skipped: raw.skipped ?? [],
    stats: raw.stats,
  };
}

export interface QuantAnalysisCalibrationInput {
  consensusScore: number;
  actualReturnPct: number;
  confidence: number | null;
  wasCorrect: boolean | null;
}

export interface QuantAnalysisCalibrationReport {
  thresholds: {
    buyThreshold: number;
    sellThreshold: number;
    minConsensusAbsOverride: number;
    qualityHoldThreshold: number;
  };
  /** False when the history was too thin — the live defaults come back as-is. */
  applied: boolean;
  reason: string | null;
  bestAccuracy: number | null;
  coverage: Record<string, number>;
  sampleCount: number;
  confidenceAccuracy: Record<string, number>;
}

interface QuantAnalysisCalibrationReportWire {
  thresholds: {
    buy_threshold: number;
    sell_threshold: number;
    min_consensus_abs_override: number;
    quality_hold_threshold: number;
  };
  applied: boolean;
  reason: string | null;
  best_accuracy: number | null;
  coverage: Record<string, number>;
  sample_count: number;
  confidence_accuracy: Record<string, number>;
}

/**
 * Asks what the decision thresholds WOULD be if tuned on validated history.
 *
 * Read-only on both sides of the split: quant-agent runs the grid search and
 * returns a report, and nothing in this codebase feeds the answer back into a
 * live decision. Tuning a decision boundary automatically, on a ±2%/±5% proxy
 * for "was that call right", is a product decision nobody has taken — so this
 * exists to make the drift VISIBLE to an operator, not to act on it.
 */
export async function calibrateQuantAnalysisThresholds(
  context: QuantAgentCallerContext,
  samples: QuantAnalysisCalibrationInput[],
): Promise<QuantAnalysisCalibrationReport> {
  const raw = await serviceRequest<QuantAnalysisCalibrationReportWire>(
    context,
    "/internal/quant-agent/analysis/calibrate",
    {
      method: "POST",
      body: JSON.stringify({
        samples: samples.map((sample) => ({
          consensus_score: sample.consensusScore,
          actual_return_pct: sample.actualReturnPct,
          confidence: sample.confidence,
          was_correct: sample.wasCorrect,
        })),
      }),
    },
    { timeoutMs: analysisTimeoutMs(), retryOnTimeout: false },
  );
  return {
    thresholds: {
      buyThreshold: raw.thresholds.buy_threshold,
      sellThreshold: raw.thresholds.sell_threshold,
      minConsensusAbsOverride: raw.thresholds.min_consensus_abs_override,
      qualityHoldThreshold: raw.thresholds.quality_hold_threshold,
    },
    applied: raw.applied,
    reason: raw.reason ?? null,
    bestAccuracy: raw.best_accuracy ?? null,
    coverage: raw.coverage ?? {},
    sampleCount: raw.sample_count,
    confidenceAccuracy: raw.confidence_accuracy ?? {},
  };
}

/** Returns null on 404 (not found) instead of throwing, mirroring §4's "or 404". */
export async function getQuantRecommendation(
  context: QuantAgentCallerContext,
  id: string,
): Promise<QuantRecommendation | null> {
  try {
    const raw = await serviceRequest<QuantRecommendationWire>(
      context,
      `/internal/quant-agent/recommendations/${encodeURIComponent(id)}`,
    );
    return normalizeQuantRecommendation(raw);
  } catch (error) {
    if (
      error instanceof QuantAgentServiceError &&
      (error.code === "QUANT_AGENT_RECOMMENDATION_NOT_FOUND" || error.status === 404)
    ) {
      return null;
    }
    throw error;
  }
}

/* ------------------------------------------------------------------
 * Automated bots (grid / DCA / martingale / layered martingale).
 *
 * The service engine stays on `SimulatedQuantBroker`. `execution_mode: live`
 * is an arming flag web reads before createIntent → executeIntent — this
 * client never opens a venue connection.
 *
 * `owner_user_id` rides on EVERY request, including the reads. The service has
 * no unscoped bot accessor, so a caller that omits it gets a 422 rather than
 * someone else's bot.
 * ------------------------------------------------------------------ */

function normalizeBotExecutionMode(raw: unknown): QuantBotExecutionModeWire {
  return isQuantBotExecutionMode(raw) ? raw : QUANT_BOT_DEFAULT_EXECUTION_MODE;
}

function normalizeBotLevels(levels: QuantBotLevelWire[] | undefined): QuantBotLevel[] {
  return (levels ?? []).map((level) => ({
    level: level.level,
    layerIndex: level.layer_index,
    orderIndex: level.order_index,
    action: level.action,
    side: level.side,
    price: level.price,
    amountQuote: level.amount_quote,
    takeProfitPrice: level.take_profit_price,
    triggerPct: level.trigger_pct,
    scheduledOffsetMinutes: level.scheduled_offset_minutes ?? null,
    cumulativeAmountQuote: level.cumulative_amount_quote ?? null,
  }));
}

function normalizeBotDiagnostics(
  raw: Record<string, unknown>[] | undefined,
): QuantBotRiskDiagnostic[] {
  return (raw ?? []).map((item) => ({
    code: String(item.code ?? ""),
    beforeLevel: Number(item.before_level ?? 0),
    basketAverage: Number(item.basket_average ?? 0),
    hardStopPrice: Number(item.hard_stop_price ?? 0),
    nextLevelPrice: Number(item.next_level_price ?? 0),
    configuredStopPct: Number(item.configured_stop_pct ?? 0),
    requiredStopPct: Number(item.required_stop_pct ?? 0),
    suggestedStopPct: Number(item.suggested_stop_pct ?? 0),
  }));
}

export function normalizeQuantBotPreview(raw: QuantBotPreviewWire): QuantBotPreview {
  const summary = raw.summary;
  return {
    // Previews are never armed — a ladder draft cannot place an order.
    executionMode: QUANT_BOT_DEFAULT_EXECUTION_MODE,
    status: raw.status,
    botType: raw.bot_type ?? "",
    config: raw.config ?? {},
    levels: normalizeBotLevels(raw.levels),
    summary: summary
      ? {
          levelCount: Number(summary.level_count ?? 0),
          totalAmountQuote: Number(summary.total_amount_quote ?? 0),
          longLevelCount: Number(summary.long_level_count ?? 0),
          shortLevelCount: Number(summary.short_level_count ?? 0),
          firstPrice: Number(summary.first_price ?? 0),
          lastPrice: Number(summary.last_price ?? 0),
        }
      : null,
    warnings: raw.warnings ?? [],
    riskDiagnostics: normalizeBotDiagnostics(raw.risk_diagnostics),
    blockingWarning: raw.blocking_warning ?? "",
    error: raw.error ?? null,
  };
}

export function normalizeQuantBot(raw: QuantBotWire): QuantBot {
  return {
    id: raw.id,
    ownerUserId: raw.owner_user_id,
    botType: raw.bot_type,
    name: raw.name,
    symbol: raw.symbol,
    market: raw.market,
    interval: raw.interval,
    executionMode: normalizeBotExecutionMode(raw.execution_mode),
    initialCapital: raw.initial_capital,
    feeRate: raw.fee_rate,
    config: raw.config ?? {},
    levels: normalizeBotLevels(raw.levels),
    warnings: raw.warnings ?? [],
    riskDiagnostics: normalizeBotDiagnostics(raw.risk_diagnostics),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export function normalizeQuantBotRun(raw: QuantBotRunWire): QuantBotRun {
  return {
    id: raw.id,
    botId: raw.bot_id,
    ownerUserId: raw.owner_user_id,
    // Runs are always simulation replays from this service.
    executionMode: QUANT_BOT_DEFAULT_EXECUTION_MODE,
    status: raw.status,
    barCount: raw.bar_count,
    fromTime: raw.from_time,
    toTime: raw.to_time,
    cellsBootstrapped: raw.cells_bootstrapped,
    ordersPlaced: raw.orders_placed,
    fillCount: raw.fill_count,
    matchedCycles: raw.matched_cycles,
    realizedProfit: raw.realized_profit,
    unrealizedProfit: raw.unrealized_profit,
    totalCommission: raw.total_commission,
    endingPrice: raw.ending_price,
    restingOrders: raw.resting_orders,
    stopReason: raw.stop_reason ?? "",
    warnings: raw.warnings ?? [],
    logs: raw.logs ?? [],
    cells: raw.cells ?? [],
    error: raw.error ?? null,
    createdAt: raw.created_at,
  };
}

/** Pure: nothing is stored and nothing is simulated. Safe to call on typing. */
export async function previewQuantBot(
  context: QuantAgentCallerContext,
  params: PreviewQuantBotParams,
): Promise<QuantBotPreview> {
  const raw = await serviceRequest<QuantBotPreviewWire>(
    context,
    "/internal/quant-agent/bots/preview",
    {
      method: "POST",
      body: JSON.stringify({ bot_type: params.botType, config: params.config }),
    },
  );
  return normalizeQuantBotPreview(raw);
}

/** Saving a bot is NOT starting one — nothing runs until bars are pushed. */
export async function createQuantBot(
  context: QuantAgentCallerContext,
  params: CreateQuantBotParams,
): Promise<QuantBot> {
  const raw = await serviceRequest<QuantBotWire>(context, "/internal/quant-agent/bots", {
    method: "POST",
    body: JSON.stringify({
      owner_user_id: context.userId,
      bot_type: params.botType,
      name: params.name,
      symbol: params.symbol,
      market: params.market,
      interval: params.interval,
      initial_capital: params.initialCapital,
      fee_rate: params.feeRate,
      config: params.config,
    }),
  });
  return normalizeQuantBot(raw);
}

export async function listQuantBots(
  context: QuantAgentCallerContext,
  limit = 50,
): Promise<QuantBot[]> {
  const query = new URLSearchParams({
    owner_user_id: String(context.userId),
    limit: String(limit),
  });
  const raw = await serviceRequest<{ bots: QuantBotWire[] }>(
    context,
    `/internal/quant-agent/bots?${query.toString()}`,
  );
  return (raw.bots ?? []).map(normalizeQuantBot);
}

/** Returns null on 404 — which is also what another tenant's id returns. */
export async function getQuantBot(
  context: QuantAgentCallerContext,
  botId: string,
): Promise<QuantBot | null> {
  const query = new URLSearchParams({ owner_user_id: String(context.userId) });
  try {
    const raw = await serviceRequest<QuantBotWire>(
      context,
      `/internal/quant-agent/bots/${encodeURIComponent(botId)}?${query.toString()}`,
    );
    return normalizeQuantBot(raw);
  } catch (error) {
    if (error instanceof QuantAgentServiceError && error.status === 404) return null;
    throw error;
  }
}

export async function deleteQuantBot(
  context: QuantAgentCallerContext,
  botId: string,
): Promise<boolean> {
  const query = new URLSearchParams({ owner_user_id: String(context.userId) });
  try {
    await serviceRequest<{ ok: boolean }>(
      context,
      `/internal/quant-agent/bots/${encodeURIComponent(botId)}?${query.toString()}`,
      { method: "DELETE" },
    );
    return true;
  } catch (error) {
    if (error instanceof QuantAgentServiceError && error.status === 404) return false;
    throw error;
  }
}

/** Owner-only arming switch. Does not place an order. */
export async function setQuantBotExecutionMode(
  context: QuantAgentCallerContext,
  params: SetQuantBotExecutionModeParams,
): Promise<QuantBot> {
  const raw = await serviceRequest<QuantBotWire>(
    context,
    `/internal/quant-agent/bots/${encodeURIComponent(params.botId)}/execution-mode`,
    {
      method: "PATCH",
      body: JSON.stringify({
        owner_user_id: context.userId,
        execution_mode: params.executionMode,
      }),
    },
  );
  return normalizeQuantBot(raw);
}

/**
 * Replay a saved bot over pushed-in candles.
 *
 * Bars go through `toServiceBars` for the same reason every other push does:
 * the service declares `time: str` and pydantic will not coerce an epoch
 * number into one, so skipping the conversion is a hard 422.
 *
 * Given its own deadline and no timeout retry — a replay over thousands of
 * bars is legitimately slow, and a second attempt would only double a wait the
 * user is already sitting through.
 */
export async function simulateQuantBot(
  context: QuantAgentCallerContext,
  params: SimulateQuantBotParams,
): Promise<QuantBotSimulation> {
  const raw = await serviceRequest<QuantBotSimulationWire>(
    context,
    `/internal/quant-agent/bots/${encodeURIComponent(params.botId)}/simulate`,
    {
      method: "POST",
      body: JSON.stringify({
        owner_user_id: context.userId,
        bars: toServiceBars(params.bars),
      }),
    },
    { timeoutMs: backtestTimeoutMs(), retryOnTimeout: false },
  );
  return {
    executionMode: QUANT_BOT_DEFAULT_EXECUTION_MODE,
    status: raw.status,
    run: raw.run ? normalizeQuantBotRun(raw.run) : null,
    fills: (raw.fills ?? []).map((fill) => ({
      sequence: fill.sequence,
      barTime: fill.bar_time,
      cellIndex: fill.cell_index,
      purpose: fill.purpose,
      price: fill.price,
      quantity: fill.quantity,
    })),
    ledger: (raw.ledger ?? []).map((entry) => ({
      sequence: entry.sequence,
      tradeType: entry.trade_type,
      closeReason: entry.close_reason,
      cellIndex: entry.cell_index,
      price: entry.price,
      amount: entry.amount,
      commission: entry.commission,
      profit: entry.profit ?? null,
      matchedEntryPrice: entry.matched_entry_price ?? null,
      gridMatchedProfit: entry.grid_matched_profit ?? null,
    })),
    error: raw.error ?? null,
  };
}

export async function listQuantBotRuns(
  context: QuantAgentCallerContext,
  botId: string,
  limit = 20,
): Promise<QuantBotRun[]> {
  const query = new URLSearchParams({
    owner_user_id: String(context.userId),
    limit: String(limit),
  });
  const raw = await serviceRequest<{ runs: QuantBotRunWire[] }>(
    context,
    `/internal/quant-agent/bots/${encodeURIComponent(botId)}/runs?${query.toString()}`,
  );
  return (raw.runs ?? []).map(normalizeQuantBotRun);
}
