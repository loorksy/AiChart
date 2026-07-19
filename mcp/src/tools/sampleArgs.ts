/**
 * Canonical canned arguments for authenticated MCP live-tool qualification.
 *
 * These MUST validate against TOOL_CATALOG input schemas. The sampleArgsParity
 * test fails if any entry drifts from the Zod contract.
 */
export const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  get_market_snapshot: { symbol: "EURUSD", interval: "15m", market: "forex" },
  get_multi_timeframe_snapshot: {
    symbol: "EURUSD",
    intervals: ["1h", "15m"],
    market: "forex",
  },
  get_market_price: { symbol: "EURUSD", market: "forex" },
  list_instruments: { market: "forex", q: "EUR" },
  get_chart_link: { symbol: "EURUSD" },
  get_market_context: { symbol: "EURUSD", interval: "15m" },
  scan_market: {
    scope: "market_scan",
    symbols: ["EURUSD", "GBPUSD"],
    interval: "5m",
    market: "forex",
  },
  get_ohlc: { symbol: "EURUSD", interval: "1h", limit: 50, market: "forex" },
  get_forex_indicators: { symbol: "EURUSD", interval: "1h", market: "forex" },
  detect_levels: { symbol: "EURUSD", interval: "1h", market: "forex" },
  get_trade_lessons: { limit: 3 },
  capture_chart_snapshot: { symbol: "EURUSD", interval: "15m" },
  capture_mt5_chart: { symbol: "EURUSD", timeframe: "15m" },
  get_chart_state: {},
  query_mt5_terminal: {},
  get_account_symbols: {},
  get_ea_live_quotes: {},
  get_ea_diagnostics: {},
  resolve_agent_skills: {
    request: "Analyze EURUSD M5 for a Forex scalp setup",
    locale: "en",
    market: "forex",
    max_skills: 2,
    allow_execution_skills: false,
  },
  load_agent_skill: {
    name: "trading-lexicon",
  },
  // Non-executing WAIT plan — proves host-model path + validateModelTradePlan
  // without placing orders. BUY/SELL matrices live in test-create-recommendation.
  create_recommendation: {
    symbol: "EURUSD",
    timeframe: "5m",
    model_id: "mcp-release-fixture",
    reasoning_effort: "high",
    snapshot_id: "mcp-release-snap-wait",
    quote_age_ms: 500,
    tick_size: 0.00001,
    current_price: 1.08501,
    allow_repair: false,
    model_plan: {
      decision: "wait",
      activation: "none",
      marketRegime: "range",
      marketThesis: "No clean scalp edge; wait for a clearer impulse.",
      primaryTimeframe: "5m",
      contextTimeframes: ["15m", "1h"],
      timeframeAnalysis: [
        {
          timeframe: "5m",
          bias: "neutral",
          evidence: "Overlapping candles inside a tight range.",
        },
      ],
      entryZone: { low: null, high: null, preferred: null },
      invalidation: null,
      stopLoss: null,
      targets: [],
      requiredConfirmation: "Break and hold outside the range.",
      pathToEntry: null,
      alternativeScenario: "If momentum expands, re-evaluate on a fresh snapshot.",
      confidence: 0.42,
      summary: "WAIT — range compression without a directional trigger.",
      keyReasons: ["Range compression", "No clean invalidation"],
      warnings: [],
      dataTimestamp: new Date().toISOString(),
    },
  },
};

/** Tools that mutate live broker state or burn credits — never auto-called. */
export const SKIP_EXEC_TOOLS = new Set([
  "open_trade",
  "close_trade",
  "close_partial",
  "modify_sl_tp",
  "cancel_mt5_order",
  "respond_approval",
  "request_approval",
  "disconnect_mt5",
  "connect_mt5",
  "send_telegram_menu",
  "request_ea_reconnect",
  "record_exit_decision",
  "evaluate_trade",
  "get_recommendation_chart",
  "run_market_analysis",
  "draw_on_chart",
  "clear_chart_drawings",
]);
