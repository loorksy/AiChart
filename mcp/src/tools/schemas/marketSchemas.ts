import { z } from "zod";
import { READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zInterval, zMarket, zSymbol } from "./shapes.js";

export const MARKET_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_market_snapshot",
    domain: "market",
    description:
      "When: quick analysis of one pair. RSI/MACD/SMA + trend. read-only. Do not use instead of get_ohlc for full indicators. Example: symbol=EURUSD&interval=1h.",
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
      "When: multi-timeframe analysis for one pair — fetches all frames in one parallel call (faster than get_market_snapshot per frame). read-only. Example: symbol=EURUSD&intervals=1h,15m,5m.",
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
      "When: live price only. read-only. For forex check quoteAgeMs via get_ea_live_quotes. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol, market: zMarket },
    annotations: READ_ONLY,
  },
  {
    name: "list_instruments",
    domain: "market",
    description:
      "When: browse/search forex pairs via OANDA, or source=ea for full broker symbols via MT5 bridge (not Market Watch only). read-only. Example: market=forex&q=EUR or source=ea&q=XAU.",
    inputSchema: {
      market: zMarket,
      q: z.string().max(20).optional().describe("Optional search e.g. EUR or XAU"),
      source: z
        .enum(["oanda", "ea"])
        .optional()
        .describe("ea = all broker symbols from MT5"),
    },
    annotations: READ_ONLY,
    ui: { widget: "pair-picker" },
  },
  {
    name: "get_chart_link",
    domain: "market",
    description:
      "When: live AiChart chart link for a pair to share with user. read-only. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol },
    annotations: READ_ONLY,
  },
  {
    name: "get_market_context",
    domain: "market",
    description:
      "When: news/mood context. read-only. No side-effects. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol, interval: zInterval },
    annotations: READ_ONLY,
  },
  {
    name: "scan_market",
    domain: "market",
    description:
      "scan market · compare symbols · best entry · pick a trade. When: 'take a trade' or 'best opportunity'. read-only. Example: symbols=[EURUSD,GBPUSD].",
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
      "When: before indicators/detect_levels. Forex via OANDA or EA. read-only. cursor/limit≤500. Example: symbol=EURUSD&interval=1h&limit=100.",
    inputSchema: {
      symbol: zSymbol.describe("EURUSD"),
      interval: zInterval,
      market: zMarket,
      source: z
        .enum(["oanda", "ea"])
        .optional()
        .describe("Forex candle source — ea required for broker suffix symbols (e.g. XAUUSDM)"),
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.number().int().optional().describe("ms — pagination cursor"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_forex_indicators",
    domain: "market",
    description:
      "When: after get_ohlc. RSI/MACD/Bollinger/ATR + trend. read-only. Not with stale quote. Example: symbol=EURUSD&interval=1h.",
    inputSchema: { symbol: zSymbol, interval: zInterval, market: zMarket },
    annotations: READ_ONLY,
  },
  {
    name: "detect_levels",
    domain: "market",
    description:
      "When: before SL/TP. Support/resistance + structure with volume-weighted strength scoring. read-only. Not a sole entry signal. Example: symbol=EURUSD&interval=4h&limit=120.",
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
      "When: before choosing a backtested strategy. Numeric regime from ATR/ADX/Bollinger/volume (trend/range/high_volatility/low_liquidity) — not a textual guess. read-only. Example: symbol=EURUSD&interval=1h&limit=240.",
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
