import {
  ATR,
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
  Stochastic,
} from "technicalindicators";
import { ema, macd, rsi, sma } from "@/lib/indicators";
import type { OhlcCandle, OhlcSource } from "./fetchOhlc";

export const INDICATORS_CACHE_TTL_MS = 45_000;

export interface ForexIndicatorsResult {
  symbol: string;
  interval: string;
  /** "metaapi" for the trader's linked account; a neutral reference-feed label when analysis-only fallback served it. */
  computedFrom: OhlcSource | "reference_feed";
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
  } | null;
  atr14: number | null;
  stochastic: { k: number; d: number } | null;
  trend: "uptrend" | "downtrend" | "sideways";
  summary: string;
}

export function indicatorsCacheResource(
  symbol: string,
  interval: string,
): string {
  return `indicators:${symbol.toUpperCase()}:${interval}`;
}

function lastValue<T>(values: T[]): T | null {
  return values.length ? values[values.length - 1]! : null;
}

function trendFromSma(
  sma20: number | null,
  sma50: number | null,
): ForexIndicatorsResult["trend"] {
  if (sma20 === null || sma50 === null) return "sideways";
  if (sma20 > sma50 * 1.002) return "uptrend";
  if (sma20 < sma50 * 0.998) return "downtrend";
  return "sideways";
}

/** Computes RSI/MACD/SMA/EMA/Bollinger/ATR/Stoch from OHLC — reuses local RSI where aligned. */
export function computeForexIndicators(
  symbol: string,
  interval: string,
  candles: OhlcCandle[],
  computedFrom: OhlcSource | "reference_feed",
): ForexIndicatorsResult {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const rsi14 = rsi(closes, 14);

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema20 = ema(closes, 20);
  const macdRes = macd(closes);

  let bollinger: ForexIndicatorsResult["bollinger"] = null;
  if (closes.length >= 20) {
    const bb = BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes,
    });
    const last = lastValue(bb);
    if (last) {
      bollinger = {
        upper: last.upper,
        middle: last.middle,
        lower: last.lower,
      };
    }
  }

  let atr14: number | null = null;
  if (candles.length >= 15) {
    const atrSeries = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });
    atr14 = lastValue(atrSeries);
  }

  let stochastic: ForexIndicatorsResult["stochastic"] = null;
  if (candles.length >= 14) {
    const stoch = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    });
    const last = lastValue(stoch);
    if (last) {
      stochastic = { k: last.k, d: last.d };
    }
  }

  const trend = trendFromSma(sma20, sma50);

  const parts: string[] = [];
  if (rsi14 !== null) {
    const rsiState =
      rsi14 >= 70 ? "تشبّع شرائي" : rsi14 <= 30 ? "تشبّع بيعي" : "محايد";
    parts.push(`RSI ${rsi14.toFixed(1)} (${rsiState})`);
  }
  parts.push(
    `الاتجاه ${trend === "uptrend" ? "صاعد" : trend === "downtrend" ? "هابط" : "عرضي"}`,
  );

  return {
    symbol,
    interval,
    computedFrom,
    rsi14,
    macd: macdRes,
    sma20,
    sma50,
    ema20,
    bollinger,
    atr14,
    stochastic,
    trend,
    summary: parts.join(" · "),
  };
}

/** Sanity helper — technicalindicators vs local RSI on same closes. */
export function rsiCrossCheck(closes: number[], period = 14): {
  local: number | null;
  lib: number | null;
} {
  const local = rsi(closes, period);
  const libSeries = RSI.calculate({ values: closes, period });
  return { local, lib: lastValue(libSeries) };
}

/** Exposed for tests — MACD via technicalindicators library. */
export function macdFromLib(closes: number[]) {
  if (closes.length < 35) return null;
  const series = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const last = lastValue(series);
  if (!last) return null;
  return {
    macd: last.MACD,
    signal: last.signal,
    histogram: last.histogram,
  };
}

/** Exposed for tests — SMA via technicalindicators library. */
export function smaFromLib(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return lastValue(SMA.calculate({ period, values: closes }));
}

/** Exposed for tests — EMA via technicalindicators library. */
export function emaFromLib(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return lastValue(EMA.calculate({ period, values: closes }));
}
