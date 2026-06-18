import { z } from "zod";
import { READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zInterval, zMarket, zSymbol } from "./shapes.js";

export const MARKET_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_market_snapshot",
    domain: "market",
    description:
      "متى: تحليل سريع لزوج واحد. RSI/MACD/SMA + اتجاه. read-only. لا تستخدم بدل get_ohlc للمؤشرات الكاملة. مثال: symbol=BTCUSDT&interval=1h.",
    inputSchema: {
      symbol: zSymbol.describe("مثل BTCUSDT"),
      interval: zInterval,
      market: zMarket,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_multi_timeframe_snapshot",
    domain: "market",
    description:
      "متى: تحليل متعدد الأطر لزوج واحد — يجلب كل الأطر بنداء واحد متوازٍ (أسرع من استدعاء get_market_snapshot لكل فريم). read-only. مثال: symbol=EURUSD&intervals=1h,15m,5m.",
    inputSchema: {
      symbol: zSymbol.describe("مثل EURUSD أو BTCUSDT"),
      intervals: z
        .array(z.string())
        .max(5)
        .optional()
        .describe("قائمة أطر، الافتراضي 1h,15m,5m — حد أقصى 5"),
      market: zMarket,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_market_price",
    domain: "market",
    description:
      "متى: سعر لحظي فقط. read-only. للفوركس تحقق quoteAgeMs عبر get_ea_live_quotes. مثال: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol, market: zMarket },
    annotations: READ_ONLY,
  },
  {
    name: "get_market_context",
    domain: "market",
    description:
      "متى: سياق أخبار/mood. read-only. لا side-effects. مثال: symbol=BTCUSDT.",
    inputSchema: { symbol: zSymbol, interval: zInterval },
    annotations: READ_ONLY,
  },
  {
    name: "scan_market",
    domain: "market",
    description:
      "متى: «خذ صفقة» — قارن رموزاً. read-only. side-effect: مسح API. مثال: symbols=[BTCUSDT,ETHUSDT].",
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
      "متى: قبل indicators/detect_levels. فوركس via EA، كريبتو Binance. read-only. cursor/limit≤500. مثال: symbol=EURUSD&interval=1h&limit=100.",
    inputSchema: {
      symbol: zSymbol.describe("EURUSD أو BTCUSDT"),
      interval: zInterval,
      market: zMarket,
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.number().int().optional().describe("ms — pagination crypto"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_forex_indicators",
    domain: "market",
    description:
      "متى: بعد get_ohlc. RSI/MACD/Bollinger/ATR + trend. read-only. لا مع quote قديم. مثال: symbol=EURUSD&interval=1h.",
    inputSchema: { symbol: zSymbol, interval: zInterval, market: zMarket },
    annotations: READ_ONLY,
  },
  {
    name: "detect_levels",
    domain: "market",
    description:
      "متى: قبل SL/TP. دعم/مقاومة + بنية. read-only. ليس إشارة دخول وحيدة. مثال: symbol=EURUSD&interval=4h&limit=120.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: zMarket,
      limit: z.number().int().min(20).max(500).optional(),
    },
    annotations: READ_ONLY,
  },
];

export const MARKET_TOOL_BY_NAME = Object.fromEntries(
  MARKET_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
