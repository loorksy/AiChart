import { z } from "zod";
import { READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zInterval, zMarket, zSymbol } from "./shapes.js";

export const MARKET_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_market_snapshot",
    domain: "market",
    description:
      "Returns a quick technical snapshot of one pair: RSI, MACD, SMA, and trend on the requested interval. When: a fast read of a single pair is enough — do not use it in place of get_ohlc when full indicator work is needed. read-only. Example: symbol=EURUSD&interval=1h.",
    inputSchema: {
      symbol: zSymbol.describe("e.g. EURUSD"),
      interval: zInterval,
      market: zMarket,
    },
    annotations: READ_ONLY,
    ui: { widget: "analysis" },
  },
  {
    name: "get_multi_timeframe_snapshot",
    domain: "market",
    description:
      "Fetches numeric snapshots for several timeframes of one pair in a single parallel call — faster than calling get_market_snapshot per frame. When: numeric-only multi-timeframe analysis; for a recommendation prefer capture_multi_timeframe_snapshot, which returns the same numbers plus the chart image per frame. read-only. Example: symbol=EURUSD&intervals=1h,15m,5m.",
    inputSchema: {
      symbol: zSymbol.describe("e.g. EURUSD"),
      intervals: z
        .array(z.string())
        .max(5)
        .optional()
        .describe("Frame list, default 1h,15m,5m — max 5"),
      market: zMarket,
    },
    annotations: READ_ONLY,
    ui: { widget: "analysis" },
  },
  {
    name: "get_market_price",
    domain: "market",
    description:
      "Returns the current live price for one symbol and nothing more. When: only the latest price is needed. read-only. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol, market: zMarket },
    annotations: READ_ONLY,
  },
  {
    name: "list_instruments",
    domain: "market",
    description:
      "Lists tradable forex instruments — from OANDA, or the linked cloud account's own symbols when one is connected — with an optional q search filter. When: browsing or searching for a pair. read-only. Example: market=forex&q=EUR.",
    inputSchema: {
      market: zMarket,
      q: z.string().max(20).optional().describe("Optional search e.g. EUR or XAU"),
    },
    annotations: READ_ONLY,
    ui: { widget: "pair-picker" },
  },
  {
    name: "get_chart_link",
    domain: "market",
    description:
      "Builds the public AiChart live-chart URL for a symbol and returns it together with the normalised symbol. When: the operator should get a shareable link to open the pair's chart. read-only. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol },
    annotations: READ_ONLY,
  },
  {
    name: "get_market_context",
    domain: "market",
    description:
      "Returns news and market-mood context for a symbol on the given interval. When: the analysis needs the narrative around the pair — sentiment and news — on top of the numbers. read-only. No side-effects. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol, interval: zInterval },
    annotations: READ_ONLY,
  },
  {
    name: "scan_market",
    domain: "market",
    description:
      "Scans and compares multiple symbols on one interval to surface the best current trading opportunity. When: the operator says 'take a trade' or asks for the best opportunity without naming a pair. read-only. scan market · compare symbols · best entry · pick a trade. Example: symbols=[EURUSD,GBPUSD].",
    inputSchema: {
      symbols: z.array(z.string()).max(30).optional(),
      interval: zInterval,
      market: zMarket,
    },
    annotations: READ_ONLY,
    ui: { widget: "recommendation-card" },
  },
  {
    name: "get_ohlc",
    domain: "market",
    description:
      "Returns raw OHLC candles for a symbol and interval from OANDA, paginated via cursor with limit≤500. When: before computing indicators or calling detect_levels, or whenever raw candles are needed. read-only. Example: symbol=EURUSD&interval=1h&limit=100.",
    inputSchema: {
      symbol: zSymbol.describe("EURUSD"),
      interval: zInterval,
      market: zMarket,
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.number().int().optional().describe("ms — pagination cursor"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_forex_indicators",
    domain: "market",
    description:
      "Computes the full indicator set for a pair on the requested interval: RSI, MACD, Bollinger, ATR, and trend. When: after get_ohlc, as the numeric backbone of an analysis — not while the quote is stale. read-only. Example: symbol=EURUSD&interval=1h.",
    inputSchema: { symbol: zSymbol, interval: zInterval, market: zMarket },
    annotations: READ_ONLY,
  },
  {
    name: "detect_levels",
    domain: "market",
    description:
      "Detects support and resistance levels plus market structure, with volume-weighted strength scoring per level. When: before placing SL/TP — treat the levels as context, not a sole entry signal. read-only. Example: symbol=EURUSD&interval=4h&limit=120.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: zMarket,
      limit: z.number().int().min(20).max(500).optional(),
    },
    annotations: READ_ONLY,
    ui: { widget: "levels-card" },
  },
  {
    name: "detect_market_regime",
    domain: "market",
    description:
      "Classifies the current market regime numerically from ATR/ADX/Bollinger/volume as trend, range, high_volatility, or low_liquidity — not a textual guess. When: before choosing a backtested strategy, so the strategy matches the regime. read-only. Example: symbol=EURUSD&interval=1h&limit=240.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: zMarket,
      limit: z.number().int().min(120).max(500).optional(),
    },
    annotations: READ_ONLY,
  },
];

export const MARKET_TOOL_BY_NAME = Object.fromEntries(
  MARKET_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
