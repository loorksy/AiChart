import { z } from "zod";
import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import {
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
    "Did the chart images agree with the numbers? confirmed | contradicted | not_checked. confirmed is only valid when a live TradingView capture included drawings (drawings_included=true). Contradicted lowers the DISPLAYED model-judgement confidence.",
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
  /**
   * The analysis this plan came from (run_market_analysis result's
   * analysis_id). The platform checks the RECORDED gate chain under this id
   * before writing — a buy/sell publish without a fresh analysis is refused.
   */
  analysis_id: z.string().min(4).max(64).optional(),
  // Optional — the model's own judgement. Never a statistically calibrated figure.
  confidence: zConfidence.optional(),
  rationale: z.string().min(10),
  factors: z.array(z.string()).min(1).max(8),
  timeframe: z.string().optional(),
  pattern_name: z.string().optional(),
  chart_drawings: zChartDrawings,
  visual_confirmation: zVisualConfirmation,
  timeframes_reviewed: zTimeframesReviewed,
  ...planContractFields,
};

/**
 * Structural shape for a recommendation.
 *
 * BUY/SELL requires LEVELS — a direction with nowhere to enter, stop, or take
 * profit is not a plan. Confidence is the model's own judgement. There is no
 * backtested_confidence, statistical_support, or strategy_id field.
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
    market_regime: z.string().min(3).max(64).optional(),
    entry: z.number().positive(),
    stop_loss: z.number().positive(),
    take_profit: z.number().positive().optional(),
    take_profits: z.array(z.number().positive()).max(3).optional(),
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
    market_regime: z.string().min(3).max(64).optional(),
    entry: z.number().positive(),
    stop_loss: z.number().positive(),
    take_profit: z.number().positive().optional(),
    take_profits: z.array(z.number().positive()).max(3).optional(),
  }),
]).superRefine((body, ctx) => {
  const hasTp =
    typeof body.take_profit === "number" ||
    (Array.isArray(body.take_profits) && body.take_profits.length > 0);
  if (!hasTp) {
    ctx.addIssue({
      code: "custom",
      path: ["take_profit"],
      message: "take_profit (or take_profits) is required for BUY/SELL recommendations",
    });
  }
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
  chart_drawings: zChartDrawings,
  market_regime: z.string().min(3).max(64).optional(),
  entry: z.number().positive().optional(),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
  take_profits: z
    .array(z.number().positive())
    .max(3)
    .optional()
    .describe("Every profit target in order (TP1..TP3). The card shows one row per unique target. take_profit is TP1; include the rest here or repeat TP1 in this array."),
  visual_confirmation: zVisualConfirmation,
  timeframes_reviewed: zTimeframesReviewed,
  ...planContractFields,
};

export const CORE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_agent_capabilities",
    domain: "core",
    description:
      "Reports what this deployment supports: server version, git commit, feature flags, and a summary of the available skill catalogue (names only). When: the first call of every session, before any other tool. Not needed again mid-session — capabilities don't change while connected. read-only. No side-effects. If next_step is returned, call it immediately without asking the user — it is the fixed session-start sequence (-> get_agent_settings -> resolve_agent_skills), not a suggestion.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_trade_lessons",
    domain: "core",
    description:
      "Retrieves lessons learned from past trades as structured JSON (result, market_context.regime) plus summary_ar; pass recent=true for the latest lessons regardless of symbol. When: optionally after a realized loss on the same symbol, or when the operator asks about past mistakes \u2014 not before every analysis. Historical observation only \u2014 never statistical support for a specific recommendation. JSON only: never present this payload as an MCP card, never paste schema_version / empty arrays / raw fields. There is no lessons card. Summarize applicable lessons in 1\u20132 sentences or say there is no relevant history. Defaults: no symbol/pattern filter (returns across all), limit unset (server default), recent=false. read-only. Example: symbol=XAUUSD&recent=true.",
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
      "Returns completed bucket-C job results (run_market_analysis and similar) as JSON in one batch — pass every job_id from a jobs_wait response that reported all_terminal:true in a single call. When: right after jobs_wait reports all_terminal:true, to read the results together. JSON only — do not present as an MCP card; summarize findings in prose, then issue the plan with create_recommendation (the only path that shows recommendation-card). Not before all_terminal — call jobs_wait again first. Never call this once per job. read-only.",
    inputSchema: {
      jobs: z
        .array(z.string().min(1))
        .min(1)
        .max(12)
        .describe("job_id values to fetch together, 1-12 per call"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "create_recommendation",
    domain: "core",
    description:
      "Records the analysis outcome as a buy or sell recommendation with its complete plan and persists it server-side; execution_state is derived by the server \u2014 do not send it. Call this in the SAME turn as the analysis BEFORE any operator-facing reply \u2014 never describe entry/SL/targets in prose first and wait to be asked for the card. On success the host AUTOMATICALLY shows recommendation-card plus the live platform chart (inline image + display_markdown) \u2014 present that card and paste display_markdown verbatim. Pass EVERY target: take_profit is TP1 and take_profits is the full list (2\u20133 numbers). Do not also present lessons, jobs, scan, snapshot, or levels JSON as cards; those tools have no UI. The only MCP cards are recommendation-card (this tool) and live-chart (show_live_chart). When: after the analysis settles on a direction \u2014 every successful analysis ends in buy or sell with a plan, and an unreadable market is reported as a named operational blocker, never as a recommendation. This platform places no orders: recording the plan IS the outcome, and acting on it is the operator's own decision elsewhere. Requires valid entry/SL/TP levels plus plan_type (immediate | anticipatory | conditional), invalidation_rule (what kills the idea), alternative_scenario (the runner-up and what switches to it), and validity_candles (1..96 of THIS timeframe); conditional and anticipatory plans additionally require BOTH activation_condition (the sentence) and activation_rule (the same condition as data \u2014 never looser than the sentence). side-effect: writes recommendation. activation_rule examples \u2014 timeframe may be omitted (defaults to the plan's timeframe); every rule needs its kind's fields: {\"kind\":\"price_touch\",\"level\":4000} \u00b7 {\"kind\":\"candle_close_above\",\"level\":4005,\"timeframe\":\"1h\"} \u00b7 {\"kind\":\"breakout_confirmed\",\"level\":4020,\"direction\":\"above\",\"closes\":2} \u00b7 {\"kind\":\"retest_confirmed\",\"level\":4000,\"direction\":\"above\",\"retestZone\":{\"low\":3995,\"high\":4002}} \u00b7 composite: {\"kind\":\"composite\",\"operator\":\"all\",\"rules\":[{\"kind\":\"price_touch\",\"level\":4000},{\"kind\":\"candle_close_above\",\"level\":4000}]}. Confidence is the model's own judgement \u2014 never a statistically calibrated figure. Do not send backtested_confidence, statistical_support, strategy_id, or backtest_evidence; those fields no longer exist. Pass visual_confirmation + timeframes_reviewed after a live TradingView capture \u2014 confirmed is only valid when drawings_included=true; otherwise use not_checked.",
    inputSchema: createRecommendationCatalogShape,
    annotations: DESTRUCTIVE,
    ui: { widget: "recommendation-card" },
  },
  {
    name: "get_agent_settings",
    domain: "core",
    description:
      "Returns the fixed product settings: Forex market, scalping style, and the operator's Risk per Trade. When: the risk setting or product configuration needs to be referenced. Not for live prices or analysis — use get_market_snapshot/get_ohlc for those. JSON only, no card. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "find_similar_cases",
    domain: "core",
    description:
      "Finds structurally similar past moments for this symbol and timeframe and returns aggregated forward outcomes for BOTH directions (buy and short) — historical observation to weigh, never confirmation of a direction already chosen, never a gate on a recommendation, and never statistical support for a specific recommendation. When: during analysis, to ask what historically followed setups like the current one. Defaults: min_similarity 0.82, limit unset (server default). found=false means no comparable indexed history — say so; do not substitute a number. A null hitRate means the sample is too small for a percentage: cite the count instead. read-only.",
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
      "Captures an image of the operator's live TradingView chart for one symbol and interval when a chart tab is open — including a background tab (image_source=tradingview_capture, drawings/studies as actually rendered, ~350 candles in view). With no live tab the response is an honest QuickChart fallback of the same ~350 candles (image_source=quickchart_fallback, fallback_reason=no_live_session, drawings_included=false) that is NEVER the user's chart — do not describe it as such, and visual_confirmation must be not_checked. The PNG is attached inline AND returned as display_markdown — ALWAYS paste display_markdown verbatim (the link expires after ~3 minutes). When: with every recommendation, or whenever the operator should see the current chart. Not for multiple timeframes at once — capture_multi_timeframe_snapshot does that in one parallel call. Default inline_image=true, include_drawings=true, include_studies=true. read-only on market; side-effect: capture.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: zMarket,
      pattern_name: z.string().optional(),
      chart_drawings: zChartDrawings,
      layout_id: z.string().optional(),
      include_drawings: zLooseBoolean
        .optional()
        .describe(
          "Include drawings already rendered on the live TradingView chart (default true). When false the same TradingView path captures a clean chart — never a QuickChart substitute.",
        ),
      include_studies: zLooseBoolean
        .optional()
        .describe(
          "Include studies already rendered on the live TradingView chart (default true). When false the same TradingView path captures without them.",
        ),
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
      "Captures several chart PNGs for one symbol IN PARALLEL (default 15m/1h/4h/1D) and pairs each image with the numeric context for that same timeframe (price, RSI, ADX, trend, nearest support/resistance from detect_levels); a timeframe that fails to render is reported in missing_timeframes while the rest still return. Prefers the operator's live TradingView tab when one is polling (including a background tab); otherwise an honest QuickChart fallback. Each image shows ~350 candles. Frames are attached inline and each carries display_markdown — when the operator should see the charts, paste each frame's display_markdown in your reply (links expire ~3 minutes). When: before every recommendation — use shorter frames for scalps ([\"5m\",\"15m\",\"1h\"]) and longer for swings ([\"1h\",\"4h\",\"1D\",\"1W\"]). Not one capture_chart_snapshot call per timeframe — that serializes what this does in parallel and burns the image budget faster. Defaults: timeframes [\"15m\",\"1h\",\"4h\",\"1D\"], max_images 4 (extra timeframes are reported, not captured), include_numeric_context true, inline_image true, inline_base64 false. Images confirm SHAPE only — every precise level must come from numeric_context, never read off the pixels. read-only on market; side-effect: capture.",
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
      layout_id: z.string().optional(),
      include_drawings: zLooseBoolean
        .optional()
        .describe(
          "Include drawings already rendered on the live TradingView chart (default true). When false the same TradingView path captures a clean chart.",
        ),
      include_studies: zLooseBoolean
        .optional()
        .describe(
          "Include studies already rendered on the live TradingView chart (default true).",
        ),
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
