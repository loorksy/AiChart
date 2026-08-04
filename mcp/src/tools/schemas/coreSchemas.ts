import { z } from "zod";
import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import {
  zBacktestStrategyId,
  zBacktestTimeframe,
  zChartDrawings,
  zConfidence,
  zDryRun,
  zInterval,
  zLooseBoolean,
  zMarket,
  zSide,
  zSymbol,
  zTradeId,
} from "./shapes.js";

/**
 * Audit-only visual review. Optional on purpose: recommendations that predate
 * multi-timeframe chart review must keep validating unchanged. `true` maps to
 * confirmed and `false` to contradicted — omit the field entirely when no
 * charts were reviewed.
 */
const zVisualConfirmation = z
  .union([z.enum(["confirmed", "contradicted", "not_checked"]), z.boolean()])
  .optional()
  .describe(
    "Did the chart images agree with the numbers? confirmed | contradicted | not_checked. Contradicted lowers the DISPLAYED confidence; it never changes backtest evidence.",
  );

const zTimeframesReviewed = z
  .array(z.string().min(1).max(16))
  .max(8)
  .optional()
  .describe(
    "Timeframes actually reviewed visually before this call (e.g. [\"15m\",\"1h\",\"4h\",\"1D\"]). Audit trail only.",
  );

/**
 * The structured activation rule — the machine-checked twin of
 * `activation_condition`. Mirrors web/src/lib/recommendations/activationRule.ts
 * exactly: the server re-validates with that schema, so drift between the two
 * fails loudly at the API boundary, never silently in storage.
 */
const zActivationLeaf = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("price_touch"),
    level: z.number().positive(),
    // Optional: absent = the candle range contained the level (either side).
    direction: z.enum(["above", "below"]).optional(),
    tolerance: z.number().nonnegative().optional(),
    timeframe: z.string().min(1).max(8).optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("candle_close_above"),
    level: z.number().positive(),
    tolerance: z.number().nonnegative().optional(),
    closes: z.number().int().min(1).max(10).optional(),
    // Optional — defaults server-side to the plan's own timeframe.
    timeframe: z.string().min(1).max(8).optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("candle_close_below"),
    level: z.number().positive(),
    tolerance: z.number().nonnegative().optional(),
    closes: z.number().int().min(1).max(10).optional(),
    // Optional — defaults server-side to the plan's own timeframe.
    timeframe: z.string().min(1).max(8).optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("breakout_confirmed"),
    level: z.number().positive(),
    direction: z.enum(["above", "below"]),
    tolerance: z.number().nonnegative().optional(),
    closes: z.number().int().min(1).max(10).optional(),
    // Optional — defaults server-side to the plan's own timeframe.
    timeframe: z.string().min(1).max(8).optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("retest_confirmed"),
    level: z.number().positive(),
    direction: z.enum(["above", "below"]),
    retestZone: z.object({ low: z.number().positive(), high: z.number().positive() }),
    tolerance: z.number().nonnegative().optional(),
    closes: z.number().int().min(1).max(10).optional(),
    // Optional — defaults server-side to the plan's own timeframe.
    timeframe: z.string().min(1).max(8).optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("rejection_confirmed"),
    level: z.number().positive(),
    direction: z.enum(["above", "below"]),
    tolerance: z.number().nonnegative().optional(),
    // Optional — defaults server-side to the plan's own timeframe.
    timeframe: z.string().min(1).max(8).optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
]);

const zActivationComposite = z.object({
  kind: z.literal("composite"),
  operator: z.enum(["all", "any"]),
  rules: z.array(zActivationLeaf).min(2).max(4),
  expiresAt: z.number().int().positive().optional(),
});

// ONE flat discriminated union over all seven kinds. The previous
// anyOf[oneOf[...], {...}] advertised shape made MCP clients flatten error
// paths into contradicting -32602 walls; keying on kind first gives producers
// exactly one branch's real problem.
export const zActivationRuleStrict = z
  .discriminatedUnion("kind", [
    ...zActivationLeaf.options,
    zActivationComposite,
  ])
  .describe(
    "The activation condition as DATA, so the tracker can grade it. Pick the kind that matches your sentence exactly — price_touch ONLY if a bare touch is genuinely enough; candle_close_above/below need level+timeframe; retest_confirmed needs the retestZone band you expect the pullback into; rejection_confirmed means a wick through the level and a close back. Never emit a rule looser than your sentence.",
  );

/**
 * The rest of the Complete Plan Contract (layers the platform already
 * enforces). Optional at the field level so the server's shared validator —
 * not a bare zod \"required\" — speaks, with one voice for both surfaces.
 */
const planContractFields = {
  entry_low: z
    .union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)])
    .optional()
    .describe("Lower bound of the entry ZONE. Omit for a single entry price."),
  entry_high: z
    .union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)])
    .optional()
    .describe("Upper bound of the entry ZONE. Omit for a single entry price."),
  activation_condition: z
    .string()
    .min(8)
    .max(400)
    .optional()
    .describe(
      "REQUIRED for conditional and anticipatory plans: the exact event that turns the plan on, in the operator's language.",
    ),
  /**
   * Stale-client compatibility, measured on a live Claude connector: a client
   * whose cached tool schema predates these fields serializes them as STRINGS.
   * The string variant is decoded and validated against the SAME rule schema in
   * the handler — a deterministic transport decode, not a looser contract.
   */
  activation_rule: z
    .union([
      zActivationRuleStrict,
      z.string().describe("JSON-encoded activation_rule (stale cached schema compatibility)"),
    ])
    .optional(),
  invalidation_rule: z
    .string()
    .min(8)
    .max(400)
    .describe("REQUIRED: what specifically kills this idea (e.g. a close beyond a level)."),
  alternative_scenario: z
    .string()
    .min(8)
    .max(400)
    .describe("REQUIRED: the runner-up scenario and what would switch the plan to it."),
  validity_candles: z
    .union([z.number().int().min(1).max(96), z.string().regex(/^\d{1,2}$/)])
    .describe("REQUIRED: how many candles of THIS timeframe the plan stays meaningful (1..96)."),
};

const recommendationSharedFields = {
  symbol: zSymbol,
  // Optional for BUY/SELL — server replaces with calibrated backtest evidence.
  confidence: zConfidence.optional(),
  rationale: z.string().min(10),
  factors: z.array(z.string()).min(1).max(8),
  timeframe: z.string().optional(),
  pattern_name: z.string().optional(),
  strategy_version: z.string().min(1).max(64).optional(),
  chart_drawings: zChartDrawings,
  visual_confirmation: zVisualConfirmation,
  timeframes_reviewed: zTimeframesReviewed,
  ...planContractFields,
};

/**
 * Structural shape for a recommendation.
 *
 * BUY/SELL requires LEVELS — a direction with nowhere to enter, stop, or take
 * profit is not a plan. It does NOT require a backtested strategy: send
 * strategy_id (and optionally backtested_confidence) when real evidence exists,
 * omit both otherwise and the server records the recommendation as direct
 * analysis with no statistical support. Evidence grades a plan; it never
 * decides whether the plan may exist.
 */
export const createRecommendationInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("buy"),
  /**
   * How the plan is entered — the contract's second layer, and mandatory.
   * A direction with no plan type does not say whether the operator should act
   * now or wait for a stated condition, which is the difference between a plan
   * and an opinion.
   */
  plan_type: z
    .enum(["immediate", "anticipatory", "conditional"])
    .describe(
      "immediate = price is in a valid entry area now. anticipatory = entering while the structure is still forming (higher risk, say so). conditional = the entry waits for a stated trigger.",
    ),
    ...recommendationSharedFields,
    strategy_id: zBacktestStrategyId.optional(),
    backtested_confidence: zConfidence.optional(),
    market_regime: z.string().min(3).max(64).optional(),
    entry: z.number().positive(),
    stop_loss: z.number().positive(),
    take_profit: z.number().positive(),
  }),
  z.object({
    action: z.literal("sell"),
  /**
   * How the plan is entered — the contract's second layer, and mandatory.
   * A direction with no plan type does not say whether the operator should act
   * now or wait for a stated condition, which is the difference between a plan
   * and an opinion.
   */
  plan_type: z
    .enum(["immediate", "anticipatory", "conditional"])
    .describe(
      "immediate = price is in a valid entry area now. anticipatory = entering while the structure is still forming (higher risk, say so). conditional = the entry waits for a stated trigger.",
    ),
    ...recommendationSharedFields,
    strategy_id: zBacktestStrategyId.optional(),
    backtested_confidence: zConfidence.optional(),
    market_regime: z.string().min(3).max(64).optional(),
    entry: z.number().positive(),
    stop_loss: z.number().positive(),
    take_profit: z.number().positive(),
  }),
]).superRefine((body, ctx) => {
  // A plan that waits must say what it waits for — in both forms. The sentence
  // is for the operator; only the rule can be machine-checked, and a stated
  // trigger nothing can check is how conditional plans filled on a bare touch.
  if (body.plan_type === "conditional" || body.plan_type === "anticipatory") {
    if (!body.activation_condition) {
      ctx.addIssue({
        code: "custom",
        path: ["activation_condition"],
        message: `a ${body.plan_type} plan requires activation_condition — the exact event that turns it on`,
      });
    }
    if (!body.activation_rule) {
      ctx.addIssue({
        code: "custom",
        path: ["activation_rule"],
        message: `a ${body.plan_type} plan requires activation_rule — the same condition as structured data the tracker can grade`,
      });
    }
  }
});

/** Trade-mode input: `auto` demands an explicit operator confirmation flag. */
export const setAgentTradeModeShape = {
  mode: z.enum(["auto", "advisory"]),
  confirmed_by_user: z
    .boolean()
    .optional()
    .describe(
      "Required true for mode=auto: proof the operator asked for standing execution authorisation in their own words.",
    ),
};

export const setAgentTradeModeInput = z.object(setAgentTradeModeShape).strict();

const findSimilarCasesShape = {
  symbol: zSymbol,
  // REQUIRED — the web route refuses a caseless interval, and advertising it
  // optional turned that refusal into an opaque 500 for the client.
  interval: z.string().min(2).max(4),
  at_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Ask about a past moment instead of now; cases at or after it are excluded so the answer is the one available then.",
    ),
  min_similarity: z
    .number()
    .min(0.5)
    .max(1)
    .optional()
    .describe("Structural-similarity floor, 0.5–1. Default 0.82."),
  limit: z.number().int().min(1).max(200).optional(),
};

export const findSimilarCasesInput = z.object(findSimilarCasesShape).strict();

/** Catalog shape stays a ZodRawShape so MCP SDK handler inference remains intact. */
const createRecommendationCatalogShape = {
  symbol: zSymbol,
  // No "wait": every successful analysis ends in a direction. An unreadable
  // market is an operational blocker reported as such, not a recommendation.
  action: z.enum(["buy", "sell"]),
  plan_type: z.enum(["immediate", "anticipatory", "conditional"]),
  confidence: zConfidence.optional(),
  rationale: z.string().min(10),
  factors: z.array(z.string()).min(1).max(8),
  timeframe: z.string().optional(),
  pattern_name: z.string().optional(),
  strategy_version: z.string().min(1).max(64).optional(),
  chart_drawings: zChartDrawings,
  strategy_id: zBacktestStrategyId.optional(),
  backtested_confidence: zConfidence.optional(),
  market_regime: z.string().min(3).max(64).optional(),
  entry: z.number().positive().optional(),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
  visual_confirmation: zVisualConfirmation,
  timeframes_reviewed: zTimeframesReviewed,
  ...planContractFields,
};

export const CORE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_account_overview",
    domain: "core",
    description:
      "Returns a combined view of the connected account in one call: technical connection status, portfolio summary, the operator's standing trade mode, and (unless include_live=false) live broker account data. When: at session start, or whenever a full picture of the account is needed before discussing balance, exposure, or execution. read-only.",
    inputSchema: {
      include_live: z
        .boolean()
        .optional()
        .describe("Include live account (slower) — false for faster summary"),
    },
    annotations: READ_ONLY,
    ui: { widget: "account-overview" },
  },
  {
    name: "get_trade_readiness",
    domain: "core",
    description:
      "Runs the technical preflight for live execution and reports authorization, broker connection, trading session, and spread for the given symbol. When: immediately before open_trade, or when diagnosing why execution is blocked. read-only.",
    inputSchema: {
      symbol: z.string().optional().describe("Pair symbol — for quote/spread check"),
      market: zMarket,
      practice: z.boolean().optional(),
    },
    annotations: READ_ONLY,
    ui: { widget: "trade-readiness" },
  },
  {
    name: "get_agent_capabilities",
    domain: "core",
    description:
      "Reports what this deployment supports: server version, git commit, feature flags, and a summary of the available skill catalogue (names only). When: the first call of every session, before any other tool. read-only. No side-effects.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_portfolio",
    domain: "core",
    description:
      "Returns the account balance and portfolio summary, including current PnL. When: after get_account_overview when only the portfolio needs refreshing, or when the operator asks about balance or PnL. read-only. Not for execution.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "portfolio" },
  },
  {
    name: "get_open_trades",
    domain: "core",
    description:
      "Lists all currently open trades together with an Arabic summary (summary_ar). When: before evaluate_trade or any close action, or when the operator asks what positions are open. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "open-trades" },
  },
  {
    name: "get_trade_lessons",
    domain: "core",
    description:
      "Retrieves lessons learned from past trades as structured JSON (result, strategy, market_context.regime, calibrated_confidence) plus summary_ar; pass recent=true for the latest lessons regardless of symbol. When: before every analysis, and after a loss to review what went wrong. read-only. Example: symbol=EURUSD&recent=true.",
    inputSchema: {
      symbol: z.string().optional(),
      pattern: z.string().optional(),
      limit: z.number().int().min(1).max(10).optional(),
      recent: z.boolean().optional().describe("Latest lessons regardless of symbol"),
    },
    annotations: READ_ONLY,
    ui: { widget: "lessons-card" },
  },
  {
    name: "run_backtest",
    domain: "core",
    description:
      "Queues a deterministic historical backtest of a catalog strategy over the given symbol, timeframe, and date_range; returns job_id/status immediately (well under 1s) — the simulation itself can take up to 120s and never blocks this call. When: before trusting a catalog strategy live, or before citing statistical support for it. Uses notional_capital for simulation sizing only (default 10000) — never live broker equity — and executes no trades. Async contract: poll with jobs_wait([job_id]) (1-12 job ids per call, long-polls up to ~20s) until all_terminal is true, then read result from that response — do not call this tool again to check status. If polling several backtests, batch every job_id into ONE jobs_wait call, never one call per job. Example: strategy_id=ema_trend_follow_v1&symbol=XAUUSD&timeframe=1h.",
    inputSchema: {
      strategy_id: zBacktestStrategyId,
      symbol: zSymbol,
      timeframe: zBacktestTimeframe,
      date_range: z
        .object({
          from: z.string().datetime({ offset: true }),
          to: z.string().datetime({ offset: true }),
        })
        .strict(),
      notional_capital: z
        .number()
        .finite()
        .min(100)
        .max(10_000_000)
        .optional()
        .describe(
          "Simulation capital for historical position sizing only (default 10000). Not live broker equity.",
        ),
    },
    annotations: IDEMPOTENT_WRITE,
  },
  {
    name: "jobs_wait",
    domain: "core",
    description:
      "Long-polls 1-12 bucket-C job ids together (run_backtest, run_market_analysis) and returns as soon as every job is terminal (completed or failed), or after ~20s if some are still running — check all_terminal, not just that the call returned. When: immediately after queuing one or more async jobs, and again after poll_after_seconds if all_terminal was false. Never poll one job at a time in a loop when several are outstanding — pass every job_id in one call. read-only.",
    inputSchema: {
      jobs: z
        .array(z.string().min(1))
        .min(1)
        .max(12)
        .describe("job_id values from run_backtest/run_market_analysis, 1-12 per call"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "show_jobs_by_ids",
    domain: "core",
    description:
      "Renders a completed batch of bucket-C jobs (run_backtest, run_market_analysis) as ONE card — pass every job_id from a jobs_wait response that reported all_terminal:true in a single call. Never call this once per job; that is what jobs_wait's batching and this tool's single-call rendering exist to prevent. Jobs that are still running are reported as such, not guessed at. read-only.",
    inputSchema: {
      jobs: z
        .array(z.string().min(1))
        .min(1)
        .max(12)
        .describe("job_id values to render together, 1-12 per call"),
    },
    annotations: READ_ONLY,
    ui: { widget: "jobs-report" },
  },
  {
    name: "get_strategy_performance",
    domain: "core",
    description:
      "Compares a strategy's live outcomes against its backtest expectation and reports its deployment state (shadow/active/suspended). When: after run_backtest, or before create_recommendation to obtain a server-issued backtested_confidence. read-only. Example: strategy_id=ema_trend_follow_v1&symbol=EURUSD&timeframe=1h.",
    inputSchema: {
      strategy_id: zBacktestStrategyId,
      symbol: z.string().optional(),
      timeframe: zBacktestTimeframe.optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "create_recommendation",
    domain: "core",
    description:
      "Records the analysis outcome as a buy or sell recommendation with its complete plan and persists it server-side; execution_state is derived by the server — do not send it. On success the response AUTOMATICALLY includes the live platform chart (inline image + display_markdown) and a recommendation_card — present the card and paste display_markdown verbatim in your reply so the operator sees both without asking. When: after the analysis settles on a direction — every successful analysis ends in buy or sell with a plan, and an unreadable market is reported as a named operational blocker, never as a recommendation. Requires valid entry/SL/TP levels plus plan_type (immediate | anticipatory | conditional), invalidation_rule (what kills the idea), alternative_scenario (the runner-up and what switches to it), and validity_candles (1..96 of THIS timeframe); conditional and anticipatory plans additionally require BOTH activation_condition (the sentence) and activation_rule (the same condition as data — never looser than the sentence). side-effect: writes recommendation. activation_rule examples — timeframe may be omitted (defaults to the plan's timeframe); every rule needs its kind's fields: {\"kind\":\"price_touch\",\"level\":4000} · {\"kind\":\"candle_close_above\",\"level\":4005,\"timeframe\":\"1h\"} · {\"kind\":\"breakout_confirmed\",\"level\":4020,\"direction\":\"above\",\"closes\":2} · {\"kind\":\"retest_confirmed\",\"level\":4000,\"direction\":\"above\",\"retestZone\":{\"low\":3995,\"high\":4002}} · composite: {\"kind\":\"composite\",\"operator\":\"all\",\"rules\":[{\"kind\":\"price_touch\",\"level\":4000},{\"kind\":\"candle_close_above\",\"level\":4000}]}. strategy_id + backtested_confidence (from get_strategy_performance) are OPTIONAL: send them when a validated strategy really matches and the server verifies them and owns the confidence; omit both and the recommendation is still recorded as direct analysis with no statistical support — never send a backtested_confidence you did not get from the server. Pass visual_confirmation + timeframes_reviewed after capture_multi_timeframe_snapshot — contradicted lowers the displayed confidence and is recorded for audit.",
    inputSchema: createRecommendationCatalogShape,
    annotations: DESTRUCTIVE,
    ui: { widget: "recommendation-card" },
  },
  {
    name: "open_trade",
    domain: "core",
    description:
      "Opens a live trade on the connected broker account; position size is derived server-side from verified broker equity, Risk per Trade, stop distance, and symbol metadata, and an unsafe technical execution state is rejected. When: only after explicit operator approval and a passing readiness check. stop_loss is mandatory; confidence is audit-only. side-effect: places a real order (idempotencyKey deduplicates for 24h). Pass dry_run:true to run every check (failure brake, authorization, market session, verified equity) and return the real risk_amount/equity figures without placing anything — use it to preview before the first live call on a symbol; the response is never cached under idempotencyKey.",
    inputSchema: {
      symbol: zSymbol,
      side: zSide,
      market: zMarket,
      entry: z.number().optional(),
      stop_loss: z.number().describe("Stop loss — mandatory, rejected without it"),
      take_profit: z.number().optional(),
      confidence: zConfidence,
      rationale: z.string().min(10),
      recommendation_id: z.number().optional(),
      approved_by_user: z.boolean().optional(),
      practice: z.boolean().optional(),
      market_type: z.literal("spot").optional(),
      order_type: z.enum(["market", "limit"]).optional(),
      limit_price: z.number().positive().optional(),
      idempotencyKey: z.string().max(128).optional().describe("idempotency 24h"),
      dry_run: zDryRun,
    },
    annotations: IDEMPOTENT_WRITE,
  },
  {
    name: "close_trade",
    domain: "core",
    description:
      "Closes one open trade by trade_id, or every open trade when all=true, on the connected account. When: the operator asks to exit, or after record_exit_decision returned close. side-effect: closes trade/all. Close trade · close position · exit · fully exit. Example: trade_id=123. Pass dry_run:true to see the live price and estimated PnL each targeted trade would realize, without closing anything — trades on a broker this platform cannot close report would_close:false with the reason instead of a number.",
    inputSchema: {
      trade_id: zTradeId.optional(),
      all: z.boolean().optional(),
      dry_run: zDryRun,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "evaluate_trade",
    domain: "core",
    description:
      "Evaluates one open trade, returning its live PnL together with current market context. When: a trade is open and the operator asks how it is doing, or before making an exit decision. read-only. Example: trade_id=42.",
    inputSchema: { trade_id: zTradeId },
    annotations: READ_ONLY,
  },
  {
    name: "record_exit_decision",
    domain: "core",
    description:
      "Records an exit-management decision (hold | close | adjust_sl) with its reason in the audit trail; it documents the decision only and never closes or modifies the position itself. When: after evaluate_trade, once a management decision has been made — follow with close_trade or modify_sl_tp to act on it. side-effect: records decision. Does not auto-close.",
    inputSchema: {
      trade_id: zTradeId,
      decision: z.enum(["hold", "close", "adjust_sl"]),
      reason: z.string().min(3).max(500),
      new_stop_loss: z.number().positive().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "request_approval",
    domain: "core",
    description:
      "Submits a proposed trade for operator approval, creating a pending intent and sending approve/reject buttons to Telegram. When: mode=approval — do not use in direct mode. side-effect: creates a pending intent and sends a Telegram message. Request approval · trade approval · send for approval · approval buttons. Pass dry_run:true to see the risk_amount/equity the card would show and confirm the card would send, without creating the intent or messaging Telegram.",
    inputSchema: {
      symbol: zSymbol,
      side: zSide,
      market: zMarket,
      entry: z.number().optional(),
      stop_loss: z.number(),
      take_profit: z.number().optional(),
      confidence: zConfidence.optional(),
      rationale: z.string().optional(),
      recommendation_id: z.number().optional(),
      practice: z.boolean().optional(),
      dry_run: zDryRun,
    },
    annotations: DESTRUCTIVE,
    ui: { widget: "approval-card" },
  },
  {
    name: "respond_approval",
    domain: "core",
    description:
      "Resolves a pending trade intent by approving or rejecting it; approving may immediately execute the trade. When: a pending intent exists and the operator has given a decision. side-effect: may execute the trade on approve. Pass dry_run:true to see the pending intent's stored levels and confirm it is still pending, without approving or rejecting it — nothing is resolved and no trade is executed.",
    inputSchema: {
      intent_id: zTradeId,
      action: z.enum(["approve", "reject"]),
      dry_run: zDryRun,
    },
    annotations: DESTRUCTIVE,
    ui: { widget: "approval-card" },
  },
  {
    name: "get_pending_approvals",
    domain: "core",
    description:
      "Lists every trade intent still awaiting operator approval. When: mode=approval, to review what is pending before requesting or responding. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "approval-queue" },
  },
  {
    name: "get_agent_settings",
    domain: "core",
    description:
      "Returns the fixed product settings: Forex market, scalping style, and the operator's Risk per Trade. When: the risk setting or product configuration needs to be referenced. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_agent_trade_mode",
    domain: "core",
    description:
      "Returns the operator's standing trading mode, shared with the platform: mode (auto | advisory), connected, and needs_choice. When: at session start after get_account_overview, and before offering execution. needs_choice=true means a connected operator has not chosen yet — ask ONCE which mode they want, remember the answer, and never re-ask on every analysis. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "set_agent_trade_mode",
    domain: "core",
    description:
      "Sets the operator's standing trading mode: 'auto' is standing authorisation for the agent to execute its own plans when their stated conditions are met, and 'advisory' means analysis and recommendations with no execution at all. When: ONLY when the operator explicitly states which mode they want in their own words — for auto, pass confirmed_by_user:true to record that. auto additionally requires a live broker connection and ends if that connection drops. side-effect: changes execution authorisation.",
    inputSchema: setAgentTradeModeShape,
    annotations: DESTRUCTIVE,
  },
  {
    name: "find_similar_cases",
    domain: "core",
    description:
      "Finds structurally similar past moments for this symbol and timeframe and returns aggregated forward outcomes for BOTH directions (buy and short) — evidence to weigh, never confirmation of a direction already chosen, and never a gate on a recommendation. When: during analysis, to ask what historically followed setups like the current one. found=false means no comparable indexed history — say so; do not substitute a number. A null hitRate means the sample is too small for a percentage: cite the count instead. read-only.",
    inputSchema: findSimilarCasesShape,
    annotations: READ_ONLY,
  },
  {
    name: "send_telegram_menu",
    domain: "core",
    description:
      "Sends the agent's menu to the operator's Telegram as an outbound notification. When: the operator should be notified on Telegram; this is not an interactive chat channel. side-effect: sends a Telegram message.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "capture_chart_snapshot",
    domain: "core",
    description:
      "Captures an image of the operator's own platform chart (the TradingView view, including the agent's drawings) for one symbol and interval. The chart is attached inline AND returned as display_markdown — ALWAYS paste display_markdown verbatim in your reply so the operator sees the picture even on hosts that hide tool images (the link inside expires after ~3 minutes). When: with every recommendation, or whenever the operator should see the current chart. read-only on market; side-effect: capture. Example: symbol=EURUSD&interval=1h.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: zMarket,
      pattern_name: z.string().optional(),
      chart_drawings: zChartDrawings,
      layout_id: z.string().optional(),
      inline_image: zLooseBoolean
        .optional()
        .describe(
          "Set false to skip the inline image copy (default true). The operator-facing display_markdown is returned either way.",
        ),
    },
    annotations: READ_ONLY,
  },
  {
    name: "capture_multi_timeframe_snapshot",
    domain: "core",
    description:
      "Captures several chart PNGs for one symbol IN PARALLEL (default 15m/1h/4h/1D) and pairs each image with the numeric context for that same timeframe (price, RSI, ADX, trend, nearest support/resistance from detect_levels); a timeframe that fails to render is reported in missing_timeframes while the rest still return. Frames are attached inline and each carries display_markdown — when the operator should see the charts, paste each frame's display_markdown in your reply (links expire ~3 minutes). When: before every recommendation — use shorter frames for scalps ([\"5m\",\"15m\",\"1h\"]) and longer for swings ([\"1h\",\"4h\",\"1D\",\"1W\"]). Images confirm SHAPE only — every precise level must come from numeric_context, never read off the pixels. read-only on market; side-effect: capture.",
    inputSchema: {
      symbol: zSymbol,
      timeframes: z
        .array(z.string().min(1).max(16))
        .max(12)
        .optional()
        .describe(
          "Timeframes to capture, ordered fine → coarse. Default [\"15m\",\"1h\",\"4h\",\"1D\"].",
        ),
      max_images: z
        .number()
        .int()
        .min(1)
        .max(6)
        .optional()
        .describe("Image budget (default 4) — extra timeframes are reported, not captured."),
      market: zMarket,
      include_numeric_context: z
        .boolean()
        .optional()
        .describe("Attach per-timeframe numbers (default true). Turn off only for a pure visual look."),
      inline_image: zLooseBoolean
        .optional()
        .describe(
          "Set false to skip the inline image copies (default true). The operator-facing display_markdown is returned either way.",
        ),
      inline_base64: zLooseBoolean
        .optional()
        .describe(
          "Also repeat raw base64 inside the JSON block (default false; implies inline_image).",
        ),
      fresh: z
        .boolean()
        .optional()
        .describe("Bypass the ~12s snapshot cache and force a fresh render."),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_recommendation_chart",
    domain: "core",
    description:
      "Fetches the stored chart PNG for a previously created recommendation — attached inline, plus display_markdown to paste verbatim in your reply so the operator sees the chart (link expires ~3 minutes). When: after create_recommendation, to show the chart recorded with it. Old recommendations without chart_image_url may fail — use capture_chart_snapshot for a live chart instead. read-only.",
    inputSchema: {
      recommendation_id: zTradeId,
      inline_image: zLooseBoolean
        .optional()
        .describe(
          "Set false to skip the inline image copy (default true). The operator-facing display_markdown is returned either way.",
        ),
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_agent_skills",
    domain: "core",
    description:
      "Discovers the canonical skill catalogue and returns metadata only (name, version, category, riskLevel, description) — it never loads skill content, and a listed skill does NOT count as loaded. When: at session start, after get_agent_capabilities, to learn which skills exist. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "resolve_agent_skills",
    domain: "core",
    description:
      "Selects the most relevant skills for the operator's current request from the catalogue and returns metadata only — the selected names plus the rejected ones with reasons, never skill bodies. When: before answering a trading or analysis request; follow with load_agent_skill for each selected name, and prefer this over manually attaching skill files. read-only.",
    inputSchema: {
      request: z
        .string()
        .min(1)
        .max(4000)
        .describe("The operator's current request / message"),
      intents: z
        .array(z.string().min(1).max(64))
        .max(12)
        .optional()
        .describe("Optional soft intent hints (e.g. analysis, recommendation)"),
      locale: z.enum(["ar", "en"]).optional(),
      market: z.string().max(32).optional().describe("Defaults to forex"),
      max_skills: z.number().int().min(1).max(4).optional(),
      allow_execution_skills: z
        .boolean()
        .optional()
        .describe("Only true when execution tools are authorized; still subject to Risk/Execution Guard"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "load_agent_skill",
    domain: "core",
    description:
      "Loads the FULL content of one named skill explicitly and traceably, and fails honestly if the skill is missing — never assume a skill was read without a successful load. When: after resolve_agent_skills, or when a specific skill is clearly needed. Skills never grant permissions. read-only.",
    inputSchema: {
      name: z
        .string()
        .min(2)
        .max(64)
        .describe("Skill name from list_agent_skills or resolve_agent_skills"),
      version: z
        .string()
        .max(32)
        .optional()
        .describe("Optional exact version (defaults to latest)"),
    },
    annotations: READ_ONLY,
  },
];

export const CORE_TOOL_BY_NAME = Object.fromEntries(
  CORE_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
