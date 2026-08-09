/**
 * Market-data collection for the Quant Agent's LLM trading analysis (Wave 1).
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/market_data_collector.py` (`collect_all`,
 * the per-timeframe loop) and `app/services/market/technical_indicators.py`
 * (`calculate_indicators`: the RSI/MACD/MA-ladder/pivot-swing-BB levels/ATR
 * volatility/trading-levels/price-position/volume-ratio math, reproduced
 * threshold for threshold).
 *
 * What changed, and why:
 *
 *  - Upstream fans out to Finnhub, yfinance, CoinGecko, Coinglass, Binance,
 *    CryptoQuant and a news search. NONE of those exist here, and this file
 *    does not add them. It reads candles from the ONE analysis feed the rest
 *    of the platform already uses (`fetchQuantAgentAnalysisBars`) and derives
 *    every number from those bars. Equity fundamentals, the news sentiment
 *    feed, the macro series and crypto derivatives are reported as absent
 *    through `missing` — never substituted with a placeholder value.
 *  - Upstream defaults several indicators when the series is too short
 *    (`price_position` → 50.0, `ma5/ma10/ma20` → the current price). We emit
 *    `null` and name the input in `degraded_inputs` instead. Defaulting a
 *    market number is a fabrication even when the default is "neutral"; the
 *    scoring side is the right place to decide what a missing component means.
 *  - The account-linked candle path (`fetchQuantAgentBars`) is deliberately
 *    NOT used. An analysis is a read of the market, not of an account: it must
 *    produce the same numbers for every user, and it must work for a user with
 *    no MetaTrader account linked at all.
 */
import { normalizeInterval } from "@/lib/intervals";
import { createLogger } from "@/lib/logger";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { computeForexIndicators } from "@/lib/ohlc/indicators";
import { sma } from "@/lib/indicators";
import {
  fetchQuantAgentAnalysisBars,
  QUANT_AGENT_DEFAULT_BAR_LIMIT,
} from "../marketFeed";
import type {
  QuantAnalysisCollectionMetaWire,
  QuantAnalysisIndicatorsWire,
  QuantAnalysisTimeframeWire,
  QuantOhlcBar,
} from "../types";

const log = createLogger("quant_agent:analysis:collect");

/**
 * Upstream pulls 60 bars per timeframe. We pull the feed's standard depth
 * instead: MACD(12,26,9) and SMA50 are materially wrong at 60 bars of warmup,
 * and this is the same limit every other quant-agent candle read already uses,
 * so it hits the warehouse's warm path rather than provoking a live backfill.
 */
export const ANALYSIS_BAR_LIMIT = QUANT_AGENT_DEFAULT_BAR_LIMIT;

/**
 * Components upstream would have collected for a Forex symbol but that have no
 * source anywhere in this codebase. Reported through `dataQuality.missing` so
 * the report can say so out loud instead of showing a confident empty bar.
 *
 * `fundamentals` is listed even though upstream's own fundamental gate never
 * fires for Forex either — the output contract still asks the model for a
 * fundamental score, so the UI needs to be able to explain why that factor has
 * nothing behind it.
 *
 * `analysis_memory` is the one entry that is no longer STRUCTURALLY absent as
 * of Wave 2: `/api/cron/quant-analysis-validate` scores aged analyses and
 * `listSimilarQuantAnalysesForSymbol` recalls them. It stays listed here
 * because collection cannot know whether anything will actually be recalled —
 * a new symbol has nothing validated for about a week — and `runAnalysis`
 * removes it from `missing` only once a pattern really came back. The default
 * is therefore still "absent", which is the honest one.
 */
export const QUANT_ANALYSIS_UNAVAILABLE_COMPONENTS = [
  "fundamentals",
  "news_sentiment",
  "macro",
  "analysis_memory",
] as const;

/**
 * AiChart interval → the timeframe label the analysis wire and quant-agent's
 * base-weight table speak (`{1M .75, 3M .75, 5M .80, 15M .85, 30M .90,
 * 1H .95, 4H 1.10, 1D 1.30, 1W 1.35}`).
 *
 * Note the one place a naive `toUpperCase()` would be wrong: AiChart's `"1M"`
 * is one MONTH, while upstream's `"1M"` is one MINUTE (it sits below `3M` and
 * `5M` in the weight table). Uppercasing would hand a monthly frame the weight
 * meant for a one-minute one, so the month maps to `"1MO"` — a label the
 * weight table does not know, which correctly falls through to 1.0.
 */
const TIMEFRAME_LABELS: Record<string, string> = {
  "1m": "1M",
  "3m": "3M",
  "5m": "5M",
  "15m": "15M",
  "30m": "30M",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
  "1M": "1MO",
};

const LABEL_INTERVALS: Record<string, string> = Object.fromEntries(
  Object.entries(TIMEFRAME_LABELS).map(([interval, label]) => [label, interval]),
);

/** The upstream timeframe label for an AiChart interval. */
export function toAnalysisTimeframeLabel(interval: string): string {
  return TIMEFRAME_LABELS[interval] ?? interval.toUpperCase();
}

/** The AiChart interval a timeframe label was built from. */
export function fromAnalysisTimeframeLabel(label: string): string {
  return LABEL_INTERVALS[label] ?? normalizeInterval(label);
}

/**
 * The consensus timeframe set, verbatim from `fast_analysis.py:762-791`:
 * `1H → +4H,1D`; `4H → +1D`; `1D → +4H`; anything else `→ +1D,4H`. Then the
 * two extra horizons the trend outlook needs (`1W`, `1H`) are appended when
 * absent — they count toward agreement but not toward the weighted score,
 * which is quant-agent's business, not ours; ours is only to make sure the
 * data for them is there.
 */
export function resolveAnalysisTimeframes(primaryInterval: string): {
  primaryLabel: string;
  labels: string[];
} {
  const primaryLabel = toAnalysisTimeframeLabel(normalizeInterval(primaryInterval));
  const labels: string[] = [primaryLabel];
  const push = (label: string) => {
    if (!labels.includes(label)) labels.push(label);
  };

  if (primaryLabel === "1H") {
    push("4H");
    push("1D");
  } else if (primaryLabel === "4H") {
    push("1D");
  } else if (primaryLabel === "1D") {
    push("4H");
  } else {
    push("1D");
    push("4H");
  }

  // Extra outlook horizons.
  push("1W");
  push("1H");
  return { primaryLabel, labels };
}

/** Per-timeframe collection outcome, plus the extras only the prompt needs. */
export interface QuantAnalysisTimeframeCollection {
  label: string;
  interval: string;
  barCount: number;
  indicators: QuantAnalysisIndicatorsWire;
  collectionMeta: QuantAnalysisCollectionMetaWire;
}

/**
 * The derived facts the prompt renders but the score wire does not carry.
 *
 * The frozen indicator snapshot is exactly ten fields, so support/resistance/
 * pivot and the ATR-derived suggested stop/target live here, on the web side,
 * where the prompt is assembled. They are still computed with upstream's exact
 * formulas so the "TECHNICAL LEVELS" block the model reads is the same block
 * upstream's model read.
 */
export interface QuantAnalysisPromptFacts {
  currentPrice: number | null;
  change24hPct: number | null;
  rsiValue: number | null;
  rsiSignal: string | null;
  macdSignal: string | null;
  macdTrend: string | null;
  maTrend: string | null;
  volatilityLevel: string | null;
  volatilityPct: number | null;
  atr: number | null;
  pricePosition: number | null;
  support: number | null;
  resistance: number | null;
  pivot: number | null;
  suggestedStopLoss: number | null;
  suggestedTakeProfit: number | null;
  riskRewardRatio: number | null;
}

export interface QuantAnalysisCollection {
  symbol: string;
  market: string;
  interval: string;
  primaryTimeframe: string;
  timeframes: Record<string, QuantAnalysisTimeframeWire>;
  primary: QuantAnalysisTimeframeCollection | null;
  promptFacts: QuantAnalysisPromptFacts;
  /** Whole components with no source on this platform. */
  missing: string[];
  /** True when a timeframe we asked for came back empty or short. */
  degraded: boolean;
  warnings: string[];
}

export interface CollectQuantAnalysisInputsOptions {
  symbol: string;
  market?: string;
  interval?: string;
  limit?: number;
}

export class QuantAnalysisCollectionError extends Error {}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Upstream: `<30 oversold`, `>70 overbought`, else `neutral`. */
function rsiSignalOf(value: number | null): string | null {
  if (value == null) return null;
  if (value < 30) return "oversold";
  if (value > 70) return "overbought";
  return "neutral";
}

/**
 * Upstream: `bullish`/`golden_cross` when `macd > signal && hist > 0`,
 * `bearish`/`death_cross` when `macd < signal && hist < 0`, else
 * `neutral`/`consolidating`.
 */
function macdSignalOf(
  macd: { macd: number; signal: number; histogram: number } | null,
): { signal: string; trend: string } | null {
  if (!macd) return null;
  if (macd.macd > macd.signal && macd.histogram > 0) {
    return { signal: "bullish", trend: "golden_cross" };
  }
  if (macd.macd < macd.signal && macd.histogram < 0) {
    return { signal: "bearish", trend: "death_cross" };
  }
  return { signal: "neutral", trend: "consolidating" };
}

/**
 * Upstream's five-way MA ladder. Unlike upstream we require a real MA20:
  * it substitutes the current price for a missing average, which quietly
 * produces `sideways` from data that cannot support any verdict at all.
 */
function maTrendOf(closes: number[], currentPrice: number): string | null {
  if (closes.length < 20) return null;
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  if (ma5 == null || ma10 == null || ma20 == null) return null;
  if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) return "strong_uptrend";
  if (currentPrice > ma20) return "uptrend";
  if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) return "strong_downtrend";
  if (currentPrice < ma20) return "downtrend";
  return "sideways";
}

/** Upstream: `>5 high`, `>2 medium`, `atr > 0 low`, else `unknown`. */
function volatilityLevelOf(volatilityPct: number | null, atr: number | null): string | null {
  if (volatilityPct == null || atr == null) return null;
  if (volatilityPct > 5) return "high";
  if (volatilityPct > 2) return "medium";
  if (atr > 0) return "low";
  return "unknown";
}

/**
 * Upstream: `(price − low20) / (high20 − low20) * 100`. Returns null rather
 * than upstream's 50.0 when the window is short or flat.
 */
function pricePositionOf(bars: QuantOhlcBar[], currentPrice: number): number | null {
  if (bars.length < 20) return null;
  const window = bars.slice(-20);
  const high20 = Math.max(...window.map((bar) => bar.high));
  const low20 = Math.min(...window.map((bar) => bar.low));
  if (!(high20 > low20)) return null;
  return round(((currentPrice - low20) / (high20 - low20)) * 100, 1);
}

/**
 * Upstream: `last_volume / mean(last 20 volumes)`. Forex candles carry tick
 * volume, which the feed may or may not populate — an absent or all-zero
 * window is reported as absent, not as a ratio of 1.
 */
function volumeRatioOf(bars: QuantOhlcBar[]): number | null {
  if (bars.length < 20) return null;
  const window = bars.slice(-20);
  if (window.some((bar) => bar.volume == null || !Number.isFinite(bar.volume))) return null;
  const total = window.reduce((sum, bar) => sum + (bar.volume ?? 0), 0);
  const average = total / window.length;
  if (!(average > 0)) return null;
  const last = window[window.length - 1]!.volume ?? 0;
  return round(last / average, 2);
}

/** Classic pivots from the PREVIOUS bar, exactly as upstream computes them. */
function levelsOf(
  bars: QuantOhlcBar[],
  bollinger: { upper: number; lower: number } | null,
): { support: number; resistance: number; pivot: number } | null {
  if (bars.length < 2) return null;
  const previous = bars[bars.length - 2]!;
  const pivot = (previous.high + previous.low + previous.close) / 3;
  const r1 = 2 * pivot - previous.low;
  const s1 = 2 * pivot - previous.high;

  const window = bars.slice(-20);
  const swingHigh = Math.max(...window.map((bar) => bar.high));
  const swingLow = Math.min(...window.map((bar) => bar.low));
  const bbUpper = bollinger?.upper ?? swingHigh;
  const bbLower = bollinger?.lower ?? swingLow;

  return {
    support: round((s1 + swingLow + bbLower) / 3, 6),
    resistance: round((r1 + swingHigh + bbUpper) / 3, 6),
    pivot: round(pivot, 6),
  };
}

/**
 * Upstream's ATR-plus-structure trading levels:
 * `SL = max(price − 2·ATR, support·0.99)`, `TP = min(price + 3·ATR,
 * resistance·1.01)`, `RR = reward / risk`.
 */
function tradingLevelsOf(
  currentPrice: number,
  atr: number | null,
  levels: { support: number; resistance: number } | null,
): { stopLoss: number; takeProfit: number; riskReward: number } | null {
  if (!levels || atr == null || !(atr > 0) || !(currentPrice > 0)) return null;
  const stopLoss = Math.max(currentPrice - 2 * atr, levels.support * 0.99);
  const takeProfit = Math.min(currentPrice + 3 * atr, levels.resistance * 1.01);
  const risk = currentPrice - stopLoss;
  const reward = takeProfit - currentPrice;
  return {
    stopLoss: round(stopLoss, 6),
    takeProfit: round(takeProfit, 6),
    riskReward: risk > 0 ? round(reward / risk, 2) : 0,
  };
}

interface TimeframeSnapshot {
  collection: QuantAnalysisTimeframeCollection;
  bars: QuantOhlcBar[];
  bollinger: { upper: number; lower: number } | null;
  atr: number | null;
  volatilityPct: number | null;
  volatilityLevel: string | null;
  levels: { support: number; resistance: number; pivot: number } | null;
  tradingLevels: { stopLoss: number; takeProfit: number; riskReward: number } | null;
  /** `golden_cross` / `death_cross` / `consolidating` — prompt-only, not on the wire. */
  macdTrend: string | null;
}

function buildTimeframeSnapshot(
  label: string,
  interval: string,
  symbol: string,
  bars: QuantOhlcBar[],
): TimeframeSnapshot {
  const degraded: string[] = [];
  const closes = bars.map((bar) => bar.close);
  const currentPrice = closes.length ? closes[closes.length - 1]! : null;

  // The shared indicator snapshot every other forex surface already uses; the
  // upstream-specific derivations below are computed on top of it, never
  // instead of it.
  const computed = bars.length
    ? computeForexIndicators(symbol, interval, bars, "reference_feed")
    : null;

  const rsiValue = computed?.rsi14 ?? null;
  if (rsiValue == null) degraded.push("rsi");

  const macd = macdSignalOf(computed?.macd ?? null);
  if (!macd) degraded.push("macd");

  const maTrend = currentPrice == null ? null : maTrendOf(closes, currentPrice);
  if (maTrend == null) degraded.push("moving_averages");

  const bollinger = computed?.bollinger
    ? { upper: computed.bollinger.upper, lower: computed.bollinger.lower }
    : null;
  if (!bollinger) degraded.push("bollinger");

  const pricePosition = currentPrice == null ? null : pricePositionOf(bars, currentPrice);
  if (pricePosition == null) degraded.push("price_position");

  const volumeRatio = volumeRatioOf(bars);
  if (volumeRatio == null) degraded.push("volume_ratio");

  const atr = computed?.atr14 ?? null;
  if (atr == null) degraded.push("atr");

  const volatilityPct =
    atr != null && currentPrice != null && currentPrice > 0 && atr > 0
      ? round((atr / currentPrice) * 100, 2)
      : null;
  const volatilityLevel = volatilityLevelOf(volatilityPct, atr);

  // Computed on every frame, not just the primary: `/finalize` reads the
  // primary's pair to mirror a long plan into a short one, and keeping the
  // snapshot uniform means the primary is never a special shape.
  const levels = levelsOf(bars, bollinger);
  const tradingLevels =
    currentPrice == null ? null : tradingLevelsOf(currentPrice, atr, levels);

  const indicators: QuantAnalysisIndicatorsWire = {
    current_price: currentPrice == null ? null : round(currentPrice, 6),
    rsi: rsiValue == null ? null : { value: round(rsiValue, 2) },
    macd: macd ? { signal: macd.signal } : null,
    moving_averages: maTrend ? { trend: maTrend } : null,
    bollinger: bollinger
      ? { upper: round(bollinger.upper, 6), lower: round(bollinger.lower, 6) }
      : null,
    price_position: pricePosition,
    volume_ratio: volumeRatio,
    volatility_pct: volatilityPct,
    atr: atr == null ? null : round(atr, 6),
    // Filled in once, from the daily series, after every timeframe is read —
    // upstream's `change_24h` comes from a single quote and is the same number
    // on every frame, not a per-timeframe measurement.
    change_24h: null,
    volatility_level: volatilityLevel,
    // Upstream keeps `indicators["trend"]` as a duplicate of the MA trend, and
    // the volume branch of the technical score reads THAT one — so the two are
    // not interchangeable and both have to be sent.
    trend: maTrend,
    suggested_stop_loss: tradingLevels?.stopLoss ?? null,
    suggested_take_profit: tradingLevels?.takeProfit ?? null,
  };

  return {
    collection: {
      label,
      interval,
      barCount: bars.length,
      indicators,
      collectionMeta: { ok: bars.length > 0 && degraded.length === 0, degraded_inputs: degraded },
    },
    bars,
    bollinger,
    atr,
    volatilityPct,
    volatilityLevel,
    levels,
    tradingLevels,
    macdTrend: macd?.trend ?? null,
  };
}

/**
 * The 24-hour price change, from the daily series.
 *
 * Upstream reads `price.changePercent` off a realtime quote. There is no quote
 * provider behind this engine, so this is measured from real candles instead:
 * last daily close against the one before it. It is the same quantity, sourced
 * differently — and when the daily series is too short it is reported absent
 * rather than guessed.
 */
function change24hFromDaily(dailyBars: QuantOhlcBar[]): number | null {
  if (dailyBars.length < 2) return null;
  const last = dailyBars[dailyBars.length - 1]!.close;
  const previous = dailyBars[dailyBars.length - 2]!.close;
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round(((last - previous) / previous) * 100, 2);
}

/**
 * Reads every timeframe the consensus and outlook need, derives the indicator
 * snapshots, and reports honestly on whatever it could not produce.
 */
export async function collectQuantAnalysisInputs(
  options: CollectQuantAnalysisInputsOptions,
): Promise<QuantAnalysisCollection> {
  const rawMarket = options.market ?? DEFAULT_MARKET;
  const marketErr = rejectNonForexMarket(rawMarket);
  if (marketErr) throw new QuantAnalysisCollectionError(marketErr);
  const market = resolveActiveMarket(rawMarket);
  const interval = normalizeInterval(options.interval ?? "1h");
  const limit = options.limit ?? ANALYSIS_BAR_LIMIT;

  const { primaryLabel, labels } = resolveAnalysisTimeframes(interval);
  const warnings: string[] = [];
  const snapshots = new Map<string, TimeframeSnapshot>();
  let symbol = options.symbol;

  // Sequential, not parallel: every frame hits the same warehouse rows for the
  // same symbol, and the feed's own live-backfill path is the expensive part —
  // firing five of those at once is how one analysis becomes five OANDA pulls.
  for (const label of labels) {
    const tfInterval = fromAnalysisTimeframeLabel(label);
    try {
      const fed = await fetchQuantAgentAnalysisBars({
        symbol: options.symbol,
        interval: tfInterval,
        market,
        limit,
      });
      symbol = fed.symbol;
      if (fed.warning) warnings.push(`${label}: ${fed.warning}`);
      snapshots.set(label, buildTimeframeSnapshot(label, tfInterval, fed.symbol, fed.bars));
    } catch (error) {
      // One unavailable horizon must not sink the whole analysis — the frame
      // is recorded as failed and quant-agent weights over what did arrive.
      log.warn("quant_agent.analysis.timeframe_fetch_failed", {
        symbol: options.symbol,
        timeframe: label,
        error: error instanceof Error ? error.message : String(error),
      });
      snapshots.set(label, buildTimeframeSnapshot(label, tfInterval, options.symbol, []));
    }
  }

  const daily = snapshots.get("1D");
  const change24h = daily ? change24hFromDaily(daily.bars) : null;

  const timeframes: Record<string, QuantAnalysisTimeframeWire> = {};
  let degraded = false;
  for (const [label, snapshot] of snapshots) {
    const indicators = { ...snapshot.collection.indicators, change_24h: change24h };
    const degradedInputs = [...snapshot.collection.collectionMeta.degraded_inputs];
    if (change24h == null) degradedInputs.push("change_24h");
    const ok = snapshot.bars.length > 0 && degradedInputs.length === 0;
    if (!ok) degraded = true;
    snapshot.collection.indicators = indicators;
    snapshot.collection.collectionMeta = { ok, degraded_inputs: degradedInputs };
    timeframes[label] = { indicators, collection_meta: snapshot.collection.collectionMeta };
  }

  const primary = snapshots.get(primaryLabel) ?? null;
  const primaryPrice = primary?.collection.indicators.current_price ?? null;

  const promptFacts: QuantAnalysisPromptFacts = {
    currentPrice: primaryPrice,
    change24hPct: change24h,
    rsiValue: primary?.collection.indicators.rsi?.value ?? null,
    rsiSignal: rsiSignalOf(primary?.collection.indicators.rsi?.value ?? null),
    macdSignal: primary?.collection.indicators.macd?.signal ?? null,
    macdTrend: primary?.macdTrend ?? null,
    maTrend: primary?.collection.indicators.moving_averages?.trend ?? null,
    volatilityLevel: primary?.volatilityLevel ?? null,
    volatilityPct: primary?.volatilityPct ?? null,
    atr: primary?.atr ?? null,
    pricePosition: primary?.collection.indicators.price_position ?? null,
    support: primary?.levels?.support ?? null,
    resistance: primary?.levels?.resistance ?? null,
    pivot: primary?.levels?.pivot ?? null,
    suggestedStopLoss: primary?.tradingLevels?.stopLoss ?? null,
    suggestedTakeProfit: primary?.tradingLevels?.takeProfit ?? null,
    riskRewardRatio: primary?.tradingLevels?.riskReward ?? null,
  };

  return {
    symbol,
    market,
    interval,
    primaryTimeframe: primaryLabel,
    timeframes,
    primary: primary?.collection ?? null,
    promptFacts,
    missing: [...QUANT_ANALYSIS_UNAVAILABLE_COMPONENTS],
    degraded,
    warnings,
  };
}
