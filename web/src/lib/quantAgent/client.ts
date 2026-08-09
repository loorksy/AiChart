import { QuantAgentServiceError } from "./errors";
import {
  isTransientQuantAgentError,
  quantAgentHttpError,
  type ServiceErrorBody,
} from "./serviceErrors";
import type {
  BacktestQuantStrategyParams,
  GenerateQuantRecommendationInput,
  GenerateQuantStrategyCodeParams,
  GenerateValidateQuantStrategyResult,
  GeneratedQuantStrategyRecord,
  GeneratedStrategySpec,
  ListQuantRecommendationsParams,
  QuantAgentCallerContext,
  QuantBacktestResult,
  QuantBacktestResultWire,
  QuantOhlcBar,
  QuantRecommendation,
  QuantRecommendationWire,
  QuantStrategyDef,
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
      body: JSON.stringify({ spec }),
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
 * Enables (or disables) a strategy the generator persisted. Restricted
 * server-side to `source_generated=true` rows only (plan §5) — this can
 * never touch the platform's two fixed built-in strategies. The only path
 * that makes a generated strategy live.
 */
export async function setQuantStrategyEnabled(
  context: QuantAgentCallerContext,
  strategyId: string,
  enabled: boolean,
): Promise<{ strategy: GeneratedQuantStrategyRecord }> {
  return serviceRequest<{ strategy: GeneratedQuantStrategyRecord }>(
    context,
    `/internal/quant-agent/strategies/${encodeURIComponent(strategyId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
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
