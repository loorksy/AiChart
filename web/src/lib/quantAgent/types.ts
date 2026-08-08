/**
 * Types for the isolated Quant Agent service HTTP contract (FROZEN — see
 * engineering plan §1-2). This is a second, independent decision engine: its
 * recommendations never touch the canonical `recommendations` table and are
 * never routed through `createCanonicalRecommendation` /
 * `applyRecommendationRevision`.
 */

export interface QuantAgentCallerContext {
  userId: number;
  requestId: string;
}

export type QuantDirection = "buy" | "sell";
export type QuantPlanType = "immediate" | "anticipatory" | "conditional";
export type QuantLifecycleState = "active" | "expired" | "invalidated" | "superseded";

/** One OHLC candle assembled by web and pushed to the service (§2 — push model). */
export interface QuantOhlcBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface QuantStrategyDef {
  strategy_id: string;
  version: string;
  display_name: string;
  enabled: boolean;
}

/** Normalized shape used everywhere in web after decoding the wire response. */
export interface QuantRecommendation {
  id: string;
  owner_user_id: number;
  symbol: string;
  market: string;
  interval: string;
  direction: QuantDirection;
  plan_type: QuantPlanType;
  entry: number | null;
  stop_loss: number;
  take_profit: number | null;
  targets: number[];
  confidence: number;
  strategy_id: string;
  strategy_version: string;
  regime: string | null;
  rationale: string;
  evidence: Record<string, unknown>;
  validity_expires_at: string | null;
  lifecycle_state: QuantLifecycleState;
  source_bar_close_time: string;
  created_at: string;
  updated_at: string;
}

/**
 * Wire shape as the service may actually send it — the contract documents
 * both `targets_json`/`targets` and `evidence_json`/`evidence` spellings, so
 * the client accepts either rather than guessing which one shipped.
 */
export interface QuantRecommendationWire {
  id: string;
  owner_user_id: number;
  symbol: string;
  market: string;
  interval: string;
  direction: QuantDirection;
  plan_type: QuantPlanType;
  entry: number | null;
  stop_loss: number;
  take_profit: number | null;
  targets_json?: string | number[] | null;
  targets?: number[] | null;
  confidence: number;
  strategy_id: string;
  strategy_version: string;
  regime?: string | null;
  rationale: string;
  evidence_json?: string | Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  validity_expires_at?: string | null;
  lifecycle_state: QuantLifecycleState;
  source_bar_close_time: string;
  created_at: string;
  updated_at: string;
}

export interface GenerateQuantRecommendationInput {
  symbol: string;
  market: string;
  interval: string;
  bars: QuantOhlcBar[];
}

export interface ListQuantRecommendationsParams {
  symbol?: string;
  state?: QuantLifecycleState | string;
}

/**
 * Declarative strategy specification shape (Quant Agent Chat's
 * `generate_strategy` flow — plan §3/§5). The LLM only ever DRAFTS this JSON;
 * the quant-agent service's pydantic schema is the actual source of truth and
 * the only thing that decides whether a spec is accepted. Kept loose here
 * (not a mirrored strict schema) since web never validates it itself — it
 * only builds the object and relays whatever the service decides.
 */
export type QuantConditionLeafType =
  | "ema_relation"
  | "rsi_threshold"
  | "macd"
  | "bollinger_touch"
  | "adx_threshold"
  | "regime";

export interface QuantConditionLeaf {
  type: QuantConditionLeafType;
  [key: string]: unknown;
}

export interface QuantConditionNode {
  all?: (QuantConditionNode | QuantConditionLeaf)[];
  any?: (QuantConditionNode | QuantConditionLeaf)[];
  not?: QuantConditionNode | QuantConditionLeaf;
}

export interface GeneratedStrategySpec {
  strategy_id: string;
  version: string;
  display_name: string;
  description?: string;
  regime_affinity?: string[];
  direction: QuantDirection;
  entry_conditions: QuantConditionNode;
  stop_loss_atr_multiple: number;
  take_profit_r_multiples: number[];
}

export interface GenerateValidateQuantStrategyError {
  path: string;
  message: string;
}

/**
 * Sandboxed-code strategy generation params (plan §4/§5) — the request body
 * for `POST /internal/quant-agent/strategies/generate-validate-code`. The
 * LLM only ever drafts the `evaluate(features)` CODE; the quant-agent
 * service's AST/regex sandbox + isolated-subprocess discovery run is the
 * only thing that decides whether it gets persisted (always `enabled: false`
 * on creation, exactly like the DSL path).
 */
export interface GenerateQuantStrategyCodeParams {
  strategyId: string;
  version: string;
  displayName: string;
  description: string;
  /** Single regime string per the sandboxed-code contract (not an array like the DSL spec's `regime_affinity`). */
  regimeAffinity: string;
  code: string;
}

/**
 * Persisted (always `enabled: false` on creation — the DB row shape, loosely
 * typed). Fields mirror the wire response directly (snake_case, no camelCase
 * mapping) — `generation_mode`/`source_code` follow that same existing
 * convention rather than introducing a one-off `generationMode`/`sourceCode`
 * pair here.
 */
export interface GeneratedQuantStrategyRecord {
  id?: string;
  strategy_id: string;
  version: string;
  display_name: string;
  enabled: boolean;
  source_generated: boolean;
  /** "declarative" (DSL path, default) | "sandboxed_code" (LLM-generated Python, plan §3). */
  generation_mode?: "declarative" | "sandboxed_code";
  /** Only non-null for `generation_mode: "sandboxed_code"` rows. */
  source_code?: string | null;
  [key: string]: unknown;
}

/** Response contract for `POST /internal/quant-agent/strategies/generate-validate` (frozen). */
export interface GenerateValidateQuantStrategyResult {
  status: "persisted" | "invalid";
  strategy?: GeneratedQuantStrategyRecord;
  errors?: GenerateValidateQuantStrategyError[];
}

/**
 * Quant Agent's own backtest engine (chat bounded quality-gate loop —
 * `POST /internal/quant-agent/strategies/{strategy_id}/backtest`, quant-agent
 * side built separately). Results are in R-multiple, never currency — Quant
 * Agent has no capital/account model to invent one from. Kept camelCase on
 * this TS side per this file's own convention for hand-built request/response
 * shapes (see `MonitorNotificationPayload.stopLoss/takeProfit` in
 * `monitorNotify.ts`) — the `*Wire` siblings mirror the actual snake_case
 * wire shape, decoded by `normalizeQuantBacktestResult` in `client.ts`.
 */
export interface QuantBacktestMetrics {
  tradeCount: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdownR: number | null;
  maxDrawdownPercent: number | null;
  sharpeR: number | null;
  metricReasons: Record<string, string>;
}

export interface QuantBacktestResult {
  status: "completed" | "invalid";
  metrics: QuantBacktestMetrics | null;
  warnings: string[] | null;
  error: string | null;
}

/** Wire (snake_case) shape as the quant-agent service actually sends it. */
export interface QuantBacktestMetricsWire {
  trade_count: number;
  win_rate: number | null;
  profit_factor: number | null;
  expectancy_r: number | null;
  max_drawdown_r: number | null;
  max_drawdown_percent: number | null;
  sharpe_r: number | null;
  metric_reasons: Record<string, string>;
}

export interface QuantBacktestResultWire {
  status: "completed" | "invalid";
  metrics: QuantBacktestMetricsWire | null;
  warnings: string[] | null;
  error: string | null;
}

/** Request params for `backtestQuantStrategy` — `bars` reuses the same `QuantOhlcBar` shape every other client function already sends. */
export interface BacktestQuantStrategyParams {
  strategyId: string;
  symbol: string;
  market: string;
  interval: string;
  bars: QuantOhlcBar[];
}
