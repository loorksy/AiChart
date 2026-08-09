/**
 * The LLM bot-config recommender: a sentence in, a clamped bot configuration
 * out.
 *
 * SIMULATION ONLY. What comes out of here is a configuration for a bot that
 * replays against historical candles. It is not an order, not a deployment,
 * and not advice to place one — see `./brokerPort.ts`.
 *
 * This lives in `web/` and not in `quant-agent/` for the same reason the
 * analysis prompt does: quant-agent has no outbound network and therefore no
 * model. Web assembles the prompt from real candles, calls the model, and
 * clamps the answer; quant-agent then validates the resulting config through
 * the same preview every hand-typed config goes through, so a hallucinated
 * number cannot reach the engine unchecked.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * (http://www.apache.org/licenses/LICENSE-2.0) —
 * `backend_api_python/app/services/strategy_bot_recommend.py`
 * (`_fetch_market_context`, `_bot_recommend_system_prompt`,
 * `_extract_json_object`, `_normalize_recommendation`, `_num`, `_int`,
 * `_bool`, `_ratio`).
 *
 * Changed on port, and the first two changes are the substantive ones:
 *
 *   - **`strategyParams` speaks the EXECUTOR vocabulary, not upstream's legacy
 *     one.** Upstream's prompt asks the model for `{upperPrice, lowerPrice,
 *     gridCount, ...}` and `{multiplier, priceDropPct, dipThreshold, ...}`.
 *     Those key names are consumed by NOTHING: `strategy_bot_recommend.py` has
 *     zero callers upstream, and a full-tree grep finds `maPeriod`,
 *     `priceDropPct` and `dipThreshold` only in that file and in Vue locale
 *     strings. Emitting them here would produce a config no engine could read.
 *     The clamps, ranges and defaults are ported value for value onto the keys
 *     the engine actually consumes (`executors.py`'s `_preview_*` schemas).
 *   - **`trend` is dropped.** Upstream offers it as one of four bot types, and
 *     no code anywhere implements it. A recommender that can suggest a bot the
 *     product cannot run is worse than one with three options.
 *   - **No `Bot type x market matrix`.** Upstream interpolates a Python dict of
 *     sets into the prompt, whose ordering is not deterministic across runs.
 *     AiChart is forex-only, so the constraint is one sentence instead.
 *   - **Market data is pushed in.** Upstream calls `KlineService()` inside the
 *     prompt builder. Here the caller supplies the candles, which keeps this
 *     module pure and testable and matches how every other quant-agent prompt
 *     in this codebase is assembled.
 *   - **`_num` still clamps rather than rejects.** That is upstream's rule: an
 *     out-of-range value is pulled to the boundary, never dropped. It stays,
 *     because a clamped number is a number the engine can validate, and the
 *     preview endpoint is the real gate either way.
 *   - **Never a fabricated market number.** When no candles are available the
 *     market block says so in upstream's own words and the model is told to
 *     recommend conservative defaults; nothing invents a price.
 */
import { DEFAULT_LOCALE, t, type AppLocale } from "@/lib/i18n";
import { callLLM } from "@/lib/llm";
import type { AnthropicResponse } from "@/lib/llm";
import type { QuantOhlcBar } from "../types";
import { QUANT_BOT_TYPES, type QuantBotRecommendation, type QuantBotType } from "./types";

/** Upstream's `temperature=0.4`, `use_json_mode=False` — parsing is manual. */
const RECOMMEND_TEMPERATURE_NOTE = "temperature is a provider default here; see llm.ts";
const RECOMMEND_MAX_TOKENS = 900;

const VALID_BOT_TYPES = new Set<string>(QUANT_BOT_TYPES);

export interface RecommendBotConfigInput {
  prompt: string;
  symbol: string;
  interval: string;
  /** Ascending candles for the market block. Empty is allowed and honest. */
  bars: QuantOhlcBar[];
  locale?: AppLocale;
}

export interface RecommendBotConfigDeps {
  callLLM: typeof callLLM;
}

export const defaultRecommendBotConfigDeps: RecommendBotConfigDeps = { callLLM };

/* ---------------------------------------------------------------- *
 * Coercion primitives — ported value for value from `_num`/`_int`/
 * `_bool`/`_ratio`. `_num` CLAMPS; it never rejects.
 * ---------------------------------------------------------------- */

export function clampNumber(
  value: unknown,
  fallback: number,
  min?: number,
  max?: number,
): number {
  let out = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(out)) out = fallback;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

export function clampInt(value: unknown, fallback: number, min?: number, max?: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

export function coerceBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return value === null || value === undefined ? fallback : Boolean(value);
}

/** Upstream's `_ratio`: clamp to [0.001, 100] FIRST, then divide by 100 if > 1. */
export function coerceRatio(value: unknown, fallback: number): number {
  const number = clampNumber(value, fallback, 0.001, 100);
  return number > 1 ? number / 100 : number;
}

/** Upstream's `_extract_json_object`: strip a fence, else first `{` to last `}`. */
export function extractJsonObject(raw: string): string {
  let text = (raw ?? "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*/, "").trim();
    if (text.endsWith("```")) text = text.slice(0, -3).trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

/* ---------------------------------------------------------------- *
 * Market context
 * ---------------------------------------------------------------- */

export interface BotMarketContext {
  block: string;
  currentPrice: number | null;
}

/**
 * Upstream's derived statistics, arithmetic unchanged.
 *
 * When there are no candles the block is upstream's own no-data sentence. It
 * does not invent a price, a range or a trend — the model is told there is no
 * data and asked for conservative defaults, exactly as upstream does.
 */
export function buildBotMarketContext(
  symbol: string,
  interval: string,
  bars: QuantOhlcBar[],
): BotMarketContext {
  if (bars.length < 5) {
    return {
      block:
        `\n\nNOTE: Symbol ${symbol} was identified but no recent K-line data was available. ` +
        "Recommend conservative defaults and tell the user to manually verify the " +
        "upper/lower bounds.\n",
      currentPrice: null,
    };
  }
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const currentPrice = closes[closes.length - 1];
  const highRecent = Math.max(...highs);
  const lowRecent = Math.min(...lows);
  const avgPrice = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const priceChangePct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
  const tail = (count: number) => closes.slice(-count);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const sma5 = closes.length >= 5 ? mean(tail(5)) : avgPrice;
  const sma20 = closes.length >= 20 ? mean(tail(20)) : avgPrice;
  const volatility = ((highRecent - lowRecent) / avgPrice) * 100;

  const block = [
    "",
    "",
    `=== REAL-TIME MARKET DATA for ${symbol} (last ${bars.length} candles, ${interval} timeframe) ===`,
    `Current Price: ${currentPrice}`,
    `Period High: ${highRecent}`,
    `Period Low: ${lowRecent}`,
    `Price Change: ${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(2)}%`,
    `Average Price: ${avgPrice.toFixed(4)}`,
    `SMA(5): ${sma5.toFixed(4)}`,
    `SMA(20): ${sma20.toFixed(4)}`,
    `Trend: ${sma5 > sma20 ? "Bullish (SMA5 > SMA20)" : "Bearish (SMA5 < SMA20)"}`,
    `Volatility (range/avg): ${volatility.toFixed(2)}%`,
    `Recent 10 closes: ${JSON.stringify(tail(10).map((value) => Number(value.toFixed(4))))}`,
    "=== END MARKET DATA ===",
    "",
    "IMPORTANT: Use the REAL market data above to set realistic parameters. For grid bots, " +
      "set start_price/end_price based on the actual Period High/Low and current volatility. " +
      "For DCA bots, consider the price level and change percentage.",
  ].join("\n");
  return { block, currentPrice };
}

/* ---------------------------------------------------------------- *
 * The prompt
 * ---------------------------------------------------------------- */

/**
 * Upstream's system prompt, retargeted at the executor vocabulary.
 *
 * The framing sentences, the "Use these exact frontend keys" instruction, the
 * percent-convention note, the "Do NOT set ... capital" rule and the
 * "Return ONLY a single valid JSON object" closer are upstream's, verbatim in
 * spirit and near-verbatim in wording. The parameter schemas are the ones the
 * engine reads.
 */
export const BOT_RECOMMEND_SYSTEM_PROMPT = [
  "You are an expert quantitative trading advisor. The user wants to configure an automated",
  "trading bot. Based on their description AND the real-time market data provided, recommend",
  "one of the three bot types and provide optimal parameters.",
  "",
  "EVERY bot in this product runs in SIMULATION ONLY: it replays against historical candles",
  "and never places an order. Recommend a configuration to test, never a trade to take.",
  "",
  "Available bot types and their parameter schemas. Use these exact keys:",
  '1. grid - Grid Trading: {start_price: number, end_price: number, grid_count: int(2-200),',
  "   grid_mode: 'arithmetic'|'geometric', side: 'long'|'short'|'neutral',",
  "   total_amount_quote: number, initial_position_pct: number(0-100),",
  "   max_open_orders: int(1-50), min_spread_between_orders: number(0-100)}",
  "2. martingale - Martingale: {entry_price: number, base_order_size: number,",
  "   safety_order_size: number, max_layers: int(1-20), price_deviation_pct: number(0.1-20),",
  "   step_multiplier: number(1-5), volume_multiplier: number(1-5),",
  "   take_profit_pct: number(0.1-50), hard_stop_pct: number(0-50), side: 'long'|'short'}",
  "3. layered_martingale - Layered Martingale: {entry_price: number, layer_count: int(1-20),",
  "   orders_per_layer: int(1-10), base_order_size: number, volume_multiplier: number(1-10),",
  "   intra_spacing_1_pct: number, intra_spacing_2_pct: number, inter_spacing_1_pct: number,",
  "   inter_spacing_2_pct: number, take_profit_pct: number, hard_stop_pct: number,",
  "   side: 'long'|'short'}",
  "4. dca - DCA (Dollar-Cost Averaging): {entry_price: number, dca_max_orders: int(1-100),",
  "   dca_interval_minutes: int(1-43200), dca_total_budget_pct: number(1-100),",
  "   dca_price_filter_enabled: boolean, dca_max_adverse_price_pct: number(0-100),",
  "   take_profit_pct: number(0.1-50)}",
  "",
  "IMPORTANT MARKET CONSTRAINT: AiChart trades forex only. marketType is always 'spot' and",
  "leverage is always 1. Do NOT recommend a crypto-only configuration.",
  "",
  "Also suggest base config:",
  "- symbol: string (use the symbol given in the request)",
  "- interval: '1m'|'5m'|'15m'|'1h'|'4h'|'1d'",
  "",
  "Risk config:",
  "- equityStopLossPct: number(0-100), stored as a 0-100 UI percent",
  "- equityTakeProfitPct: number(0-1000), stored as a 0-100 UI percent",
  "",
  "Percent convention: fields ending in Pct or _pct are 0-100 UI percentages.",
  "Do NOT set initialCapital, initialAmount or totalBudget. The user enters starting capital",
  "separately, and the platform sizes each level from it.",
  "Return ONLY a single valid JSON object with botType, botName, reason, baseConfig,",
  "strategyParams, and riskConfig.",
].join("\n");

function extractText(response: AnthropicResponse): string {
  return response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/* ---------------------------------------------------------------- *
 * Normalization
 * ---------------------------------------------------------------- */

function normalizeSide(value: unknown, allowNeutral: boolean): string {
  const raw = String(value ?? "long").trim().toLowerCase();
  if (allowNeutral && raw === "neutral") return "neutral";
  return raw === "short" ? "short" : "long";
}

function gridParams(
  params: Record<string, unknown>,
  currentPrice: number | null,
): Record<string, number | string | boolean> {
  // No fabricated price: with no market data the bounds stay at whatever the
  // model proposed, clamped to non-negative, and the caller sees a preview
  // warning rather than a plausible-looking invention.
  const fallbackLow = currentPrice === null ? 0 : currentPrice * 0.98;
  const fallbackHigh = currentPrice === null ? 0 : currentPrice * 1.02;
  return {
    start_price: clampNumber(params.start_price, fallbackLow, 0),
    end_price: clampNumber(params.end_price, fallbackHigh, 0),
    grid_count: clampInt(params.grid_count, 10, 2, 200),
    grid_mode:
      params.grid_mode === "geometric" || params.grid_mode === "arithmetic"
        ? params.grid_mode
        : "arithmetic",
    side: normalizeSide(params.side, false),
    total_amount_quote: clampNumber(params.total_amount_quote, 0, 0),
    initial_position_pct: clampNumber(params.initial_position_pct, 0, 0, 100),
    max_open_orders: clampInt(params.max_open_orders, 4, 1, 50),
    min_spread_between_orders: clampNumber(params.min_spread_between_orders, 0.05, 0, 100),
  };
}

function martingaleParams(
  params: Record<string, unknown>,
  currentPrice: number | null,
): Record<string, number | string | boolean> {
  return {
    entry_price: clampNumber(params.entry_price, currentPrice ?? 0, 0),
    base_order_size: clampNumber(params.base_order_size, 10, 0),
    safety_order_size: clampNumber(params.safety_order_size, 10, 0),
    max_layers: clampInt(params.max_layers, 5, 1, 20),
    price_deviation_pct: clampNumber(params.price_deviation_pct, 3, 0.1, 20),
    step_multiplier: clampNumber(params.step_multiplier, 1.4, 1, 5),
    volume_multiplier: clampNumber(params.volume_multiplier, 1.6, 1, 5),
    take_profit_pct: clampNumber(params.take_profit_pct, 2, 0.1, 50),
    hard_stop_pct: clampNumber(params.hard_stop_pct, 12, 0, 50),
    side: normalizeSide(params.side, false),
  };
}

function layeredMartingaleParams(
  params: Record<string, unknown>,
  currentPrice: number | null,
): Record<string, number | string | boolean> {
  return {
    entry_price: clampNumber(params.entry_price, currentPrice ?? 0, 0),
    layer_count: clampInt(params.layer_count, 5, 1, 20),
    orders_per_layer: clampInt(params.orders_per_layer, 3, 1, 10),
    base_order_size: clampNumber(params.base_order_size, 10, 0),
    volume_multiplier: clampNumber(params.volume_multiplier, 1.8, 1, 10),
    intra_spacing_1_pct: clampNumber(params.intra_spacing_1_pct, 0.5, 0, 100),
    intra_spacing_2_pct: clampNumber(params.intra_spacing_2_pct, 0.8, 0, 100),
    inter_spacing_1_pct: clampNumber(params.inter_spacing_1_pct, 1.2, 0, 100),
    inter_spacing_2_pct: clampNumber(params.inter_spacing_2_pct, 1.5, 0, 100),
    take_profit_pct: clampNumber(params.take_profit_pct, 0.6, 0.1, 50),
    hard_stop_pct: clampNumber(params.hard_stop_pct, 12, 0, 50),
    side: normalizeSide(params.side, false),
  };
}

function dcaParams(
  params: Record<string, unknown>,
  currentPrice: number | null,
): Record<string, number | string | boolean> {
  return {
    entry_price: clampNumber(params.entry_price, currentPrice ?? 0, 0),
    dca_max_orders: clampInt(params.dca_max_orders, 5, 1, 100),
    dca_interval_minutes: clampInt(params.dca_interval_minutes, 1440, 1, 43200),
    dca_total_budget_pct: clampNumber(params.dca_total_budget_pct, 95, 1, 100),
    dca_price_filter_enabled: coerceBool(params.dca_price_filter_enabled, false),
    dca_max_adverse_price_pct: clampNumber(params.dca_max_adverse_price_pct, 5, 0, 100),
    take_profit_pct: clampNumber(params.take_profit_pct, 0.6, 0.1, 50),
  };
}

const PARAM_NORMALIZERS: Record<
  QuantBotType,
  (params: Record<string, unknown>, currentPrice: number | null) => Record<
    string,
    number | string | boolean
  >
> = {
  grid: gridParams,
  martingale: martingaleParams,
  layered_martingale: layeredMartingaleParams,
  dca: dcaParams,
};

const VALID_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

/**
 * Clamp a raw model answer into something the engine can be handed.
 *
 * Upstream's sequence: an unrecognized `botType` becomes `grid`; every scalar
 * is clamped, not rejected; unknown extra keys inside `strategyParams` survive
 * (the engine's own preview ignores what it does not know).
 */
export function normalizeBotRecommendation(
  raw: Record<string, unknown>,
  input: { symbol: string; interval: string; currentPrice: number | null },
): QuantBotRecommendation {
  const rawType = String(raw.botType ?? "").trim().toLowerCase();
  const botType: QuantBotType = VALID_BOT_TYPES.has(rawType) ? (rawType as QuantBotType) : "grid";
  const baseConfig = (raw.baseConfig ?? {}) as Record<string, unknown>;
  const params = { ...((raw.strategyParams ?? {}) as Record<string, unknown>) };
  const riskConfig = (raw.riskConfig ?? {}) as Record<string, unknown>;

  const interval = String(baseConfig.interval ?? input.interval).trim().toLowerCase();

  return {
    botType,
    botName: String(raw.botName ?? "").trim() || `${botType} ${input.symbol}`,
    reason: String(raw.reason ?? "").trim(),
    baseConfig: {
      // The caller's symbol always wins: the model may not rename the market
      // the user asked about.
      symbol: input.symbol,
      market: "forex",
      interval: VALID_INTERVALS.has(interval) ? interval : input.interval,
      // Forex on this platform is spot and unlevered. Not negotiable by prompt.
      marketType: "spot",
      leverage: 1,
    },
    strategyParams: {
      ...(Object.fromEntries(
        Object.entries(params).filter(
          ([, value]) =>
            typeof value === "number" || typeof value === "string" || typeof value === "boolean",
        ),
      ) as Record<string, number | string | boolean>),
      ...PARAM_NORMALIZERS[botType](params, input.currentPrice),
    },
    riskConfig: {
      equityStopLossPct: clampNumber(riskConfig.equityStopLossPct, 10, 0, 100),
      equityTakeProfitPct: clampNumber(riskConfig.equityTakeProfitPct, 20, 0, 1000),
    },
  };
}

export class BotRecommendationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotRecommendationError";
  }
}

/**
 * Ask the model for a bot configuration.
 *
 * One attempt, no repair loop — matching the quant-agent chat's own simpler
 * idiom rather than the synthesizer's corrective retry. The clamps below turn
 * almost any well-formed object into a usable config, and a response that is
 * not JSON at all is a provider problem a second identical call will not fix.
 */
export async function recommendBotConfig(
  input: RecommendBotConfigInput,
  deps: RecommendBotConfigDeps = defaultRecommendBotConfigDeps,
): Promise<QuantBotRecommendation> {
  void RECOMMEND_TEMPERATURE_NOTE;
  const locale = input.locale ?? DEFAULT_LOCALE;
  const market = buildBotMarketContext(input.symbol, input.interval, input.bars);
  const response = await deps.callLLM(
    {
      system: BOT_RECOMMEND_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `User request:\n${input.prompt.trim()}${market.block}`,
        },
      ],
      maxTokens: RECOMMEND_MAX_TOKENS,
    },
    { tier: "deep" },
  );
  const text = extractText(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    throw new BotRecommendationError(t(locale, "qa.bots.recommend.error"));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BotRecommendationError(t(locale, "qa.bots.recommend.error"));
  }
  return normalizeBotRecommendation(parsed as Record<string, unknown>, {
    symbol: input.symbol,
    interval: input.interval,
    currentPrice: market.currentPrice,
  });
}
