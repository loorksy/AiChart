import { z } from "zod";
import { READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zInterval, zMarket, zSymbol } from "./shapes.js";

export const MARKET_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_market_snapshot",
    domain: "market",
    description:
      "Returns a quick technical snapshot of one pair: RSI, MACD, SMA, and trend on the requested interval. When: a fast read of a single pair is enough — do not use it in place of get_ohlc when full indicator work is needed. JSON for the model — never present as an MCP card. Broker-suffixed symbols (e.g. XAUUSDm) are canonicalized to the 6-letter key before the read — if that changed what you sent, it comes back in adjustments; never tell the operator the requested spelling was queried verbatim when adjustments is present. read-only. Example: symbol=EURUSD&interval=1h.",
    inputSchema: {
      symbol: zSymbol.describe("e.g. EURUSD"),
      interval: zInterval,
      market: zMarket,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_multi_timeframe_snapshot",
    domain: "market",
    description:
      "Fetches numeric snapshots for several timeframes of one pair in a single parallel call — faster than calling get_market_snapshot per frame. When: numeric-only multi-timeframe analysis; for a recommendation prefer capture_multi_timeframe_snapshot, which returns the same numbers plus the chart image per frame. JSON for the model — never present as an MCP card. Not several get_market_snapshot calls back to back — this does it in one parallel round trip. Broker-suffixed symbols are canonicalized to the 6-letter key before the read; a changed symbol comes back in adjustments — never claim the requested spelling was queried verbatim when it's present. read-only. Example: symbol=EURUSD&intervals=1h,15m,5m.",
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
  },
  {
    name: "get_market_price",
    domain: "market",
    description:
      "Returns the current live price for one symbol and nothing more. When: only the latest price is needed — not for indicators or history, use get_forex_indicators/get_ohlc for those. Broker-suffixed symbols are canonicalized to the 6-letter key before the read; a changed symbol comes back in adjustments. This is also the recovery_tool for a STALE_QUOTE error elsewhere — call it immediately to force a fresh read, don't ask the operator first. read-only. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol, market: zMarket },
    annotations: READ_ONLY,
  },
  {
    name: "list_instruments",
    domain: "market",
    description:
      "Lists tradable forex instruments — the linked account's own symbols, or the shared broker-seeded catalogue before a link — with an optional q search filter. When: browsing or searching for a pair. JSON only — not a pair-picker card. Not for a linked account's own broker-specific spelling and spread — that's get_account_symbols instead, when a live MT5 connection exists. Symbols here are unchanged, never canonicalized. read-only. Example: market=forex&q=EUR.",
    inputSchema: {
      market: zMarket,
      q: z.string().max(20).optional().describe("Optional search e.g. EUR or XAU"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_chart_link",
    domain: "market",
    description:
      "Builds the public Lonora live-chart URL for a symbol and returns it together with the normalised symbol. When: the operator should get a shareable link to open the pair's chart. Not for showing the chart in this conversation — capture_chart_snapshot/show_live_chart attach the actual image, this only returns a URL. read-only. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol },
    annotations: READ_ONLY,
  },
  {
    name: "get_market_context",
    domain: "market",
    description:
      "Returns news and market-mood context for a symbol on the given interval. When: the analysis needs the narrative around the pair — sentiment and news — on top of the numbers. Not a substitute for technical evidence — narrative context informs a plan's conditions and validity, it never decides direction by itself. Symbol is used as given, never canonicalized. read-only. No side-effects. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol, interval: zInterval },
    annotations: READ_ONLY,
  },
  {
    name: "scan_market",
    domain: "market",
    description:
      "Scans and compares multiple symbols on one interval and ranks them by an undirected opportunity score (mixed bullish/bearish technical signal strength) — it does NOT compute a buy/sell direction; the response has no action/side field. When: the operator says 'take a trade' or asks for the best opportunity without naming a pair, to shortlist a candidate. JSON ranking only — never present as a card. Not a recommendation by itself — the top-scored symbol still needs its own real directional analysis (get_market_snapshot/detect_levels/etc.) before create_recommendation; never read the score's signals list as a verdict. read-only. scan market · compare symbols · best entry · pick a trade. Example: symbols=[EURUSD,GBPUSD].",
    inputSchema: {
      symbols: z.array(z.string()).max(30).optional(),
      interval: zInterval,
      market: zMarket,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_ohlc",
    domain: "market",
    description:
      "Returns raw OHLC candles for a symbol and interval from the user's linked MetaTrader account, paginated via cursor with limit≤500. When: before computing indicators or calling detect_levels, or whenever raw candles are needed — this is mechanical input for further computation, not something to present to the operator directly. Broker-suffixed symbols are canonicalized to the 6-letter key before the read; a changed symbol comes back in adjustments. Default limit unset (server default, ≤500). read-only. Example: symbol=EURUSD&interval=1h&limit=100.",
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
      "Computes the full indicator set for a pair on the requested interval: RSI, MACD, Bollinger, ATR, and trend. When: after get_ohlc, as the numeric backbone of an analysis — not while the quote is stale. Symbol is used as given, never canonicalized (unlike get_market_snapshot/get_ohlc/get_market_price/detect_market_regime) — pass the exact spelling you want indicators computed for. read-only. Example: symbol=EURUSD&interval=1h.",
    inputSchema: { symbol: zSymbol, interval: zInterval, market: zMarket },
    annotations: READ_ONLY,
  },
  {
    name: "detect_levels",
    domain: "market",
    description:
      "Detects support and resistance levels plus market structure, with volume-weighted strength scoring per level. When: before placing SL/TP — treat the levels as context, not a sole entry signal. JSON levels for plan construction — never present as a levels card; cite them in prose or draw them with draw_on_chart. Symbol is used as given, never canonicalized — unlike get_market_snapshot/get_ohlc/get_market_price/detect_market_regime, a broker-suffixed symbol is NOT stripped here. Default limit unset (server default, 20-500). read-only. Example: symbol=EURUSD&interval=4h&limit=120.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: zMarket,
      limit: z.number().int().min(20).max(500).optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "detect_market_regime",
    domain: "market",
    description:
      "Classifies the current market regime numerically from ATR/ADX/Bollinger/volume as trend, range, high_volatility, or low_liquidity — not a textual guess. When: before choosing a backtested strategy, so the strategy matches the regime. Broker-suffixed symbols are canonicalized to the 6-letter key before the read; a changed symbol comes back in adjustments. Default limit unset (server default, 120-500). read-only. Example: symbol=EURUSD&interval=1h&limit=240.",
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
