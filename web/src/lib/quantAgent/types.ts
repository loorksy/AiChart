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

/* ------------------------------------------------------------------ *
 * LLM trading analysis (Wave 1)
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/fast_analysis.py` and
 * `fast_analysis_scoring.py`. What changed: the wire contract is split in
 * two because `quant-agent/` has no outbound network at all — web collects
 * the data and calls the LLM, quant-agent owns every score, the consensus,
 * the outlook and the post-LLM validation. Equity fundamentals, the news
 * sentiment feed, macro series and crypto derivatives have no source on this
 * platform, so those components are sent as explicit `null` (upstream already
 * weights over PRESENT components only) and named in `dataQuality.missing`
 * rather than substituted with an invented number.
 * ------------------------------------------------------------------ */

export type QuantAnalysisDecision = "BUY" | "SELL" | "HOLD";

export interface QuantAnalysisOutlookLeg {
  label: string; // bearish | bullish | neutral
  qualifier: string; // mild | neutral | strong
  score: number;
}

/**
 * The per-timeframe indicator snapshot pushed to `/analysis/score` — the
 * FROZEN wire shape, so it stays snake_case (same rule as
 * `QuantRecommendationWire`). Every member is nullable: a warmup-short series
 * genuinely has no RSI, and reporting that is the contract, not defaulting it.
 */
export interface QuantAnalysisIndicatorsWire {
  current_price: number | null;
  rsi: { value: number | null } | null;
  macd: { signal: string } | null;
  moving_averages: { trend: string } | null;
  bollinger: { upper: number; lower: number } | null;
  price_position: number | null;
  volume_ratio: number | null;
  volatility_pct: number | null;
  atr: number | null;
  change_24h: number | null;
  /**
   * The four fields below are beyond the ten the contract sample listed, but
   * `quant-agent`'s `TimeframeIndicators` declares and READS every one of
   * them, so omitting them would quietly disable real upstream behaviour:
   *
   *  - `volatility_level` feeds the similar-pattern band comparison.
   *  - `trend` is NOT interchangeable with `moving_averages.trend` — the
   *    volume branch of the technical score reads this one first, exactly as
   *    upstream's `indicators["trend"]` does.
   *  - `suggested_stop_loss` / `suggested_take_profit` are the ATR-derived
   *    long levels `/finalize` mirrors around price for a short. Without them
   *    the mirror path can never fire and every SELL falls back to the flat
   *    1.05/0.95 defaults.
   */
  volatility_level?: string | null;
  trend?: string | null;
  suggested_stop_loss?: number | null;
  suggested_take_profit?: number | null;
}

/** Per-timeframe collection outcome — what the feed could and could not produce. */
export interface QuantAnalysisCollectionMetaWire {
  ok: boolean;
  degraded_inputs: string[];
}

export interface QuantAnalysisTimeframeWire {
  indicators: QuantAnalysisIndicatorsWire;
  collection_meta: QuantAnalysisCollectionMetaWire;
}

/**
 * One prior, outcome-validated analysis offered to quant-agent's
 * similar-pattern scorer.
 *
 * Sent empty for the whole of Wave 1 — `quant_analyses` stored neither an
 * indicator snapshot nor a validated outcome. Wave 2 added both
 * (`indicators_json`, `validated_at`/`was_correct`), so
 * `listSimilarQuantAnalysesForSymbol` now fills this list from the caller's own
 * validated history. It is still empty, and `analysis_memory` still reported
 * through `dataQuality.missing`, until the validation cron has scored something
 * — roughly a week after a symbol's first analysis on an account.
 */
export interface QuantAnalysisMemoryCandidateWire {
  id: string;
  decision: QuantAnalysisDecision;
  was_correct: boolean | null;
  indicators: {
    rsi: number | null;
    macd_signal: string;
    ma_trend: string;
    volatility_level: string;
    price_position: number | null;
  };
}

/** Params for `scoreQuantAnalysis` — camelCase, per this file's convention for hand-built request shapes. */
export interface ScoreQuantAnalysisParams {
  market: string;
  symbol: string;
  primaryTimeframe: string;
  currentPrice: number | null;
  /** Keyed by the upstream timeframe label ("1H", "4H", "1D", "1W"). */
  timeframes: Record<string, QuantAnalysisTimeframeWire>;
  memoryCandidates: QuantAnalysisMemoryCandidateWire[];
}

export interface QuantAnalysisObjectiveWire {
  technical_score: number | null;
  fundamental_score: number | null;
  sentiment_score: number | null;
  macro_score: number | null;
  overall_score: number;
  decision: QuantAnalysisDecision;
  abs_score: number;
}

export interface QuantAnalysisConsensusWire {
  decision: QuantAnalysisDecision;
  score: number;
  agreement: number;
  timeframe_count: number;
  votes: Record<string, number>;
  weighted_score: number;
}

export interface QuantAnalysisTrendOutlookWire {
  h24: QuantAnalysisOutlookLeg;
  d3: QuantAnalysisOutlookLeg;
  w1: QuantAnalysisOutlookLeg;
  m1: QuantAnalysisOutlookLeg;
}

export interface QuantAnalysisSimilarPatternWire {
  id: string;
  similarity_score: number;
  decision: QuantAnalysisDecision;
  was_correct: boolean | null;
}

export interface QuantAnalysisDataQualityWire {
  degraded: boolean;
  confidence_penalty: number;
  missing: string[];
}

export interface QuantAnalysisScoreResultWire {
  objective_by_timeframe: Record<string, QuantAnalysisObjectiveWire>;
  consensus: QuantAnalysisConsensusWire;
  trend_outlook: QuantAnalysisTrendOutlookWire;
  similar_patterns: QuantAnalysisSimilarPatternWire[];
  data_quality: QuantAnalysisDataQualityWire;
}

/** Decoded (camelCase) `/analysis/score` response. */
export interface QuantAnalysisObjective {
  technicalScore: number | null;
  fundamentalScore: number | null;
  sentimentScore: number | null;
  macroScore: number | null;
  overallScore: number;
  decision: QuantAnalysisDecision;
  absScore: number;
}

export interface QuantAnalysisConsensus {
  decision: QuantAnalysisDecision;
  score: number;
  agreement: number;
  timeframeCount: number;
  votes: Record<string, number>;
  weightedScore: number;
}

export interface QuantAnalysisTrendOutlook {
  h24: QuantAnalysisOutlookLeg;
  d3: QuantAnalysisOutlookLeg;
  w1: QuantAnalysisOutlookLeg;
  m1: QuantAnalysisOutlookLeg;
}

export interface QuantAnalysisSimilarPattern {
  id: string;
  similarityScore: number;
  decision: QuantAnalysisDecision;
  wasCorrect: boolean | null;
}

export interface QuantAnalysisDataQuality {
  degraded: boolean;
  confidencePenalty: number;
  missing: string[];
}

export interface QuantAnalysisScoreResult {
  objectiveByTimeframe: Record<string, QuantAnalysisObjective>;
  consensus: QuantAnalysisConsensus;
  trendOutlook: QuantAnalysisTrendOutlook;
  similarPatterns: QuantAnalysisSimilarPattern[];
  dataQuality: QuantAnalysisDataQuality;
}

/**
 * The raw JSON object the analysis LLM is asked to return (QuantDinger
 * `fast_analysis.py:471-490`). Kept snake_case and loose: web never validates
 * it — it strips fences, parses, and relays whatever came back to
 * `/analysis/finalize`, which is the only thing that clamps and vetoes it.
 * `report` is the extra key upstream's repair ladder attaches when parsing
 * failed outright (`llm.py:1400-1442`).
 */
export interface QuantAnalysisLlmOutput {
  decision: string;
  confidence: number;
  summary: string;
  analysis?: { technical?: string; fundamental?: string; sentiment?: string } | string | null;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  position_size_pct: number;
  timeframe: string;
  key_reasons: string[];
  risks: string[];
  technical_score: number;
  fundamental_score: number;
  sentiment_score: number;
  report?: string;
  [key: string]: unknown;
}

/**
 * What quant-agent actually changed while constraining the model's output.
 *
 * `indicator_conflicts` is additive to the frozen contract: upstream buries
 * the conflict list inside a Chinese sentence appended to `summary`, and
 * quant-agent emits machine-readable codes instead so this side can render
 * them in the user's own language.
 */
export interface QuantAnalysisFinalizeApplied {
  entry_clamped: boolean;
  stop_defaulted: boolean;
  take_profit_defaulted: boolean;
  decision_overridden_by: null | "indicators" | "consensus";
  confidence_adjusted_by: number;
  indicator_conflicts?: string[];
}

/** `/analysis/finalize` response — the same keys as `llm_output`, plus `applied`. */
export interface QuantAnalysisFinalizeResult extends QuantAnalysisLlmOutput {
  applied: QuantAnalysisFinalizeApplied;
}

export interface FinalizeQuantAnalysisParams {
  market: string;
  symbol: string;
  /** Required, not nullable — an analysis without a price was never run. */
  currentPrice: number;
  /** The PRIMARY timeframe's snapshot only — the same object sent under `timeframes[primary]`. */
  indicators: QuantAnalysisIndicatorsWire;
  llmOutput: QuantAnalysisLlmOutput;
  /**
   * Both are permanently `false` on this platform: there is no news feed and
   * no macro series behind this engine, so upstream's `allow_override` escape
   * hatch (which lets a major event excuse an indicator conflict) can never
   * be claimed. That is the conservative branch, and it is honest.
   */
  hasMajorNews: boolean;
  hasMacroEvent: boolean;
  consensus: QuantAnalysisConsensus;
  /**
   * Passed straight back from `/score`. Optional on the service side, but
   * omitting it makes the engine assume undegraded inputs — which would drop
   * upstream's `quality_multiplier` effect on confidence entirely.
   */
  dataQuality?: QuantAnalysisDataQuality | null;
}

/**
 * The persisted, user-facing analysis (FROZEN — shared by the API and the UI).
 * Scores are the LLM's own 0–100 self-assessment for technical/fundamental/
 * sentiment plus the rule-computed `overall`; the −100..+100 objective
 * components live in the score response, not here.
 */
export interface QuantAnalysisRecord {
  id: string;
  market: string;
  symbol: string;
  interval: string;
  status: "completed" | "failed";
  decision: QuantAnalysisDecision | null;
  confidence: number | null;
  currentPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  positionSizePct: number | null;
  horizon: "short" | "medium" | "long" | null;
  summary: string | null;
  scores: {
    technical: number | null;
    fundamental: number | null;
    sentiment: number | null;
    overall: number | null;
  };
  consensus: {
    decision: QuantAnalysisDecision;
    score: number;
    agreement: number;
    timeframeCount: number;
  } | null;
  outlook: {
    h24: QuantAnalysisOutlookLeg;
    d3: QuantAnalysisOutlookLeg;
    w1: QuantAnalysisOutlookLeg;
    m1: QuantAnalysisOutlookLeg;
  } | null;
  detail: { technical: string; fundamental: string; sentiment: string } | null;
  reasons: string[];
  risks: string[];
  dataQuality: {
    degraded: boolean;
    missing: string[];
    /**
     * Close time of the newest bar every price in this row was derived from,
     * epoch ms. Null only when the primary frame came back empty.
     *
     * A price with no as-of time reads as a live quote, and the reader has no
     * way to tell a market that moved from an analysis that is wrong. This is
     * what lets the surface say "priced at 14:00" instead of implying "now".
     */
    asOfMs?: number | null;
    /**
     * Set when the feed itself reported the series as behind wall clock. The
     * warning was already produced upstream and used to be discarded here, so
     * a three-day-old-but-complete series was reported as fully healthy.
     */
    staleness?: string[];
    /**
     * How the prices in this row relate to the reader's own broker.
     *
     * `anchored` means every level was translated into their price space by
     * `delta`; `divergent` means the two books disagreed too much to reconcile
     * and the level fields were withheld rather than shown in the wrong space.
     * Recorded because "this number was moved, by this much" is a materially
     * different claim from "this number is as measured".
     */
    priceBasis?: {
      status: string;
      delta: number;
      divergenceRatio: number | null;
    };
  } | null;
  error: string | null;
  createdAt: string;
}
