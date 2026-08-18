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
    name: "get_agent_capabilities",
    domain: "core",
    description:
      "Reports what this deployment supports: server version, git commit, feature flags, and a summary of the available skill catalogue (names only). When: the first call of every session, before any other tool. Not needed again mid-session — capabilities don't change while connected. read-only. No side-effects. If next_step is returned, call it immediately without asking the user — it is the fixed session-start sequence (-> get_account_overview -> get_agent_trade_mode), not a suggestion.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_trade_lessons",
    domain: "core",
    description:
      "Retrieves lessons learned from past trades as structured JSON (result, strategy, market_context.regime, calibrated_confidence) plus summary_ar; pass recent=true for the latest lessons regardless of symbol. When: before every analysis, and after a loss to review what went wrong. Not a substitute for get_strategy_performance — lessons are past-trade outcomes, not a strategy's live-vs-backtest evidence. Defaults: no symbol/pattern filter (returns across all), limit unset (server default), recent=false. read-only. Example: symbol=EURUSD&recent=true.",
    inputSchema: {
      symbol: z.string().optional(),
      pattern: z.string().optional(),
      limit: z.number().int().min(1).max(10).optional(),
      recent: z.boolean().optional().describe("Latest lessons regardless of symbol"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "jobs_wait",
    domain: "core",
    description:
      "Long-polls 1-12 bucket-C job ids together (run_market_analysis and similar) and returns as soon as every job is terminal (completed or failed), or after ~20s if some are still running — check all_terminal, not just that the call returned. When: immediately after queuing one or more async jobs, and again after poll_after_seconds if all_terminal was false. Not for a job_id you already saw reported completed/failed — that result is final, re-polling wastes a call. Never poll one job at a time in a loop when several are outstanding — pass every job_id in one call; the 12-job cap is enforced, not a suggestion. Job ids are process-local — after a server restart every previously issued job_id reports not_found, which is expected, not an error to retry. read-only.",
    inputSchema: {
      jobs: z
        .array(z.string().min(1))
        .min(1)
        .max(12)
        .describe("job_id values from run_market_analysis and similar, 1-12 per call"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "show_jobs_by_ids",
    domain: "core",
    description:
      "Renders a completed batch of bucket-C jobs (run_market_analysis and similar) as ONE card — pass every job_id from a jobs_wait response that reported all_terminal:true in a single call. When: right after jobs_wait reports all_terminal:true, to show the operator the results together. Not before all_terminal — call jobs_wait again first, don't guess at a still-running job's outcome. Never call this once per job; that is what jobs_wait's batching and this tool's single-call rendering exist to prevent. read-only.",
    inputSchema: {
      jobs: z
        .array(z.string().min(1))
        .min(1)
        .max(12)
        .describe("job_id values to render together, 1-12 per call"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_strategy_performance",
    domain: "core",
    description:
      "Compares a strategy's live outcomes against its existing backtest evidence and reports its deployment state (shadow/active/suspended). Evidence is whatever was already computed for this strategy/symbol/timeframe — there is no tool to run a new backtest, so an unbacktested combination reports no evidence rather than one. When: before create_recommendation to obtain a server-issued backtested_confidence. Not a source of confidence numbers to invent from — only a confidence value THIS tool returned may be passed to create_recommendation's backtested_confidence field. read-only. Example: strategy_id=ema_trend_follow_v1&symbol=EURUSD&timeframe=1h.",
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
      "Records the analysis outcome as a buy or sell recommendation with its complete plan and persists it server-side; execution_state is derived by the server — do not send it. On success the response AUTOMATICALLY includes the live platform chart (inline image + display_markdown) and a recommendation_card — present the card and paste display_markdown verbatim in your reply so the operator sees both without asking. When: after the analysis settles on a direction — every successful analysis ends in buy or sell with a plan, and an unreadable market is reported as a named operational blocker, never as a recommendation. This platform places no orders: recording the plan IS the outcome, and acting on it is the operator's own decision elsewhere. Requires valid entry/SL/TP levels plus plan_type (immediate | anticipatory | conditional), invalidation_rule (what kills the idea), alternative_scenario (the runner-up and what switches to it), and validity_candles (1..96 of THIS timeframe); conditional and anticipatory plans additionally require BOTH activation_condition (the sentence) and activation_rule (the same condition as data — never looser than the sentence). side-effect: writes recommendation. activation_rule examples — timeframe may be omitted (defaults to the plan's timeframe); every rule needs its kind's fields: {\"kind\":\"price_touch\",\"level\":4000} · {\"kind\":\"candle_close_above\",\"level\":4005,\"timeframe\":\"1h\"} · {\"kind\":\"breakout_confirmed\",\"level\":4020,\"direction\":\"above\",\"closes\":2} · {\"kind\":\"retest_confirmed\",\"level\":4000,\"direction\":\"above\",\"retestZone\":{\"low\":3995,\"high\":4002}} · composite: {\"kind\":\"composite\",\"operator\":\"all\",\"rules\":[{\"kind\":\"price_touch\",\"level\":4000},{\"kind\":\"candle_close_above\",\"level\":4000}]}. strategy_id + backtested_confidence (from get_strategy_performance) are OPTIONAL: send them when a validated strategy really matches and the server verifies them and owns the confidence; omit both and the recommendation is still recorded as direct analysis with no statistical support — never send a backtested_confidence you did not get from the server. Pass visual_confirmation + timeframes_reviewed after capture_multi_timeframe_snapshot — contradicted lowers the displayed confidence and is recorded for audit.",
    inputSchema: createRecommendationCatalogShape,
    annotations: DESTRUCTIVE,
    ui: { widget: "recommendation-card" },
  },
  {
    name: "get_agent_settings",
    domain: "core",
    description:
      "Returns the fixed product settings: Forex market, scalping style, and the operator's Risk per Trade. When: the risk setting or product configuration needs to be referenced. Not for live equity or exposure figures — that's get_account_overview/get_portfolio. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "find_similar_cases",
    domain: "core",
    description:
      "Finds structurally similar past moments for this symbol and timeframe and returns aggregated forward outcomes for BOTH directions (buy and short) — evidence to weigh, never confirmation of a direction already chosen, and never a gate on a recommendation. When: during analysis, to ask what historically followed setups like the current one. Not a substitute for get_strategy_performance's live-vs-backtest comparison — this is unlabelled historical pattern matching, not a validated strategy's track record. Defaults: min_similarity 0.82, limit unset (server default). found=false means no comparable indexed history — say so; do not substitute a number. A null hitRate means the sample is too small for a percentage: cite the count instead. read-only.",
    inputSchema: findSimilarCasesShape,
    annotations: READ_ONLY,
  },
  {
    name: "send_telegram_menu",
    domain: "core",
    description:
      "Sends the agent's menu to the operator's Telegram as an outbound notification. When: the operator should be notified on Telegram; this is not an interactive chat channel — a reply the operator sends on Telegram does not come back through this tool call. side-effect: sends a Telegram message.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "capture_chart_snapshot",
    domain: "core",
    description:
      "Captures an image of the operator's own platform chart (the TradingView view, including the agent's drawings) for one symbol and interval. The chart is attached inline AND returned as display_markdown — ALWAYS paste display_markdown verbatim in your reply so the operator sees the picture even on hosts that hide tool images (the link inside expires after ~3 minutes). When: with every recommendation, or whenever the operator should see the current chart. Not for multiple timeframes at once — capture_multi_timeframe_snapshot does that in one parallel call instead of several of these. Default inline_image=true. read-only on market; side-effect: capture. Example: symbol=EURUSD&interval=1h.",
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
      "Captures several chart PNGs for one symbol IN PARALLEL (default 15m/1h/4h/1D) and pairs each image with the numeric context for that same timeframe (price, RSI, ADX, trend, nearest support/resistance from detect_levels); a timeframe that fails to render is reported in missing_timeframes while the rest still return. Frames are attached inline and each carries display_markdown — when the operator should see the charts, paste each frame's display_markdown in your reply (links expire ~3 minutes). When: before every recommendation — use shorter frames for scalps ([\"5m\",\"15m\",\"1h\"]) and longer for swings ([\"1h\",\"4h\",\"1D\",\"1W\"]). Not one capture_chart_snapshot call per timeframe — that serializes what this does in parallel and burns the image budget faster. Defaults: timeframes [\"15m\",\"1h\",\"4h\",\"1D\"], max_images 4 (extra timeframes are reported, not captured), include_numeric_context true, inline_image true, inline_base64 false. Images confirm SHAPE only — every precise level must come from numeric_context, never read off the pixels. read-only on market; side-effect: capture.",
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
      "Discovers the canonical skill catalogue and returns metadata only (name, version, category, riskLevel, description) — it never loads skill content, and a listed skill does NOT count as loaded. When: at session start, after get_agent_capabilities, to learn which skills exist. Not the normal path to actually using a skill for a specific request — prefer resolve_agent_skills for that; this is a full-catalogue browse. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "resolve_agent_skills",
    domain: "core",
    description:
      "Selects the most relevant skills for the operator's current request from the catalogue and returns metadata only — the selected names plus the rejected ones with reasons, never skill bodies. When: before answering a trading or analysis request; follow with load_agent_skill for each selected name, and prefer this over manually attaching skill files. Not a way to load a skill by itself — this only decides WHICH ones, load_agent_skill is the separate step that actually reads content. Defaults: locale unset (auto), market forex, max_skills 3, allow_execution_skills false (set true only when execution tools are actually authorized). read-only. If next_step is returned, call it immediately without asking the user — it names exactly which load_agent_skill calls are required.",
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
      "Loads the FULL content of one named skill explicitly and traceably, and fails honestly if the skill is missing — never assume a skill was read without a successful load. When: after resolve_agent_skills, or when a specific skill is clearly needed. Not for discovering which skill to load — that's resolve_agent_skills/list_agent_skills; this needs an exact name. Default version: latest. Skills never grant permissions — loading one never authorizes an execution tool call it wasn't already authorized for. read-only.",
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
