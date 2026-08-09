import { ADX, ATR, BollingerBands } from "technicalindicators";
import type { OhlcCandle } from "./fetchOhlc";

export type NumericMarketRegime =
  | "trending"
  | "ranging"
  | "high_volatility"
  | "low_liquidity"
  | "unknown";

export type MarketTrendDirection = "bullish" | "bearish" | "neutral";

export const MARKET_REGIME_THRESHOLDS = Object.freeze({
  minimumCandles: 60,
  adxTrendingMinimum: 25,
  directionalSpreadMinimum: 5,
  highAtrRatio: 1.5,
  highBollingerBandwidthRatio: 1.35,
  extremeVolatilityRatio: 2,
  lowVolumeRatio: 0.55,
  minimumVolumeCoverage: 0.8,
});

export interface MarketRegimeMetrics {
  atr14: number | null;
  atrPercent: number | null;
  atrBaselinePercent: number | null;
  atrRatio: number | null;
  adx14: number | null;
  plusDi14: number | null;
  minusDi14: number | null;
  bollingerBandwidth: number | null;
  bollingerBaselineBandwidth: number | null;
  bollingerBandwidthRatio: number | null;
  recentAverageVolume: number | null;
  baselineAverageVolume: number | null;
  volumeRatio: number | null;
  volumeCoverage: number;
}

export interface MarketRegimeAnalysis {
  regime: NumericMarketRegime;
  trendDirection: MarketTrendDirection;
  candleCount: number;
  metrics: MarketRegimeMetrics;
  signals: {
    trending: boolean;
    highVolatility: boolean;
    lowLiquidity: boolean;
  };
  reasons: string[];
  thresholds: typeof MARKET_REGIME_THRESHOLDS;
}

const EPSILON = 1e-12;

function round(value: number | null, digits = 8): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lastValue<T>(values: T[]): T | null {
  return values.length ? values[values.length - 1]! : null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function relativeRatio(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || Math.abs(baseline) <= EPSILON) {
    return null;
  }
  return current / baseline;
}

function emptyMetrics(): MarketRegimeMetrics {
  return {
    atr14: null,
    atrPercent: null,
    atrBaselinePercent: null,
    atrRatio: null,
    adx14: null,
    plusDi14: null,
    minusDi14: null,
    bollingerBandwidth: null,
    bollingerBaselineBandwidth: null,
    bollingerBandwidthRatio: null,
    recentAverageVolume: null,
    baselineAverageVolume: null,
    volumeRatio: null,
    volumeCoverage: 0,
  };
}

function unknownResult(candleCount: number, reason: string): MarketRegimeAnalysis {
  return {
    regime: "unknown",
    trendDirection: "neutral",
    candleCount,
    metrics: emptyMetrics(),
    signals: {
      trending: false,
      highVolatility: false,
      lowLiquidity: false,
    },
    reasons: [reason],
    thresholds: MARKET_REGIME_THRESHOLDS,
  };
}

function isValidCandle(candle: OhlcCandle): boolean {
  return (
    [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high)
  );
}

function alignedPercentSeries(values: number[], closes: number[]): number[] {
  const offset = closes.length - values.length;
  return values.flatMap((value, index) => {
    const close = closes[offset + index];
    return close != null && close > 0 && Number.isFinite(value)
      ? [value / close]
      : [];
  });
}

function bollingerBandwidthSeries(closes: number[]): number[] {
  return BollingerBands.calculate({
    period: 20,
    stdDev: 2,
    values: closes,
  }).flatMap((band) =>
    Number.isFinite(band.middle) && Math.abs(band.middle) > EPSILON
      ? [(band.upper - band.lower) / Math.abs(band.middle)]
      : [],
  );
}

function volumeMetrics(candles: OhlcCandle[]): Pick<
  MarketRegimeMetrics,
  | "recentAverageVolume"
  | "baselineAverageVolume"
  | "volumeRatio"
  | "volumeCoverage"
> {
  const window = candles.slice(-60);
  const usable = (value: number | undefined): value is number =>
    value != null && Number.isFinite(value) && value > 0;
  const coverage = window.length
    ? window.filter((candle) => usable(candle.volume)).length / window.length
    : 0;
  const recent = window.slice(-10).map((candle) => candle.volume).filter(usable);
  const baseline = window.slice(0, -10).map((candle) => candle.volume).filter(usable);
  const recentAverageVolume = mean(recent);
  const baselineAverageVolume = mean(baseline);
  return {
    recentAverageVolume: round(recentAverageVolume, 4),
    baselineAverageVolume: round(baselineAverageVolume, 4),
    volumeRatio: round(relativeRatio(recentAverageVolume, baselineAverageVolume), 6),
    volumeCoverage: round(coverage, 4) ?? 0,
  };
}

/**
 * Deterministic numeric market-regime classifier.
 *
 * Rule priority is deliberate: an exceptional volatility expansion is reported
 * before trend, then a well-covered volume collapse, then ADX trend. Everything
 * else with sufficient data is a range. No LLM or wall-clock state is involved.
 */
export function detectNumericMarketRegime(
  candles: OhlcCandle[],
): MarketRegimeAnalysis {
  if (candles.length < MARKET_REGIME_THRESHOLDS.minimumCandles) {
    return unknownResult(candles.length, "insufficient_candles");
  }
  if (!candles.every(isValidCandle)) {
    return unknownResult(candles.length, "invalid_candles");
  }

  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const closes = candles.map((candle) => candle.close);

  const atrSeries = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr14 = lastValue(atrSeries);
  const atrPercentSeries = alignedPercentSeries(atrSeries, closes);
  const atrPercent = lastValue(atrPercentSeries);
  const atrBaselinePercent = median(atrPercentSeries.slice(-61, -1));
  const atrRatio = relativeRatio(atrPercent, atrBaselinePercent);

  const adx = lastValue(
    ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }),
  );

  const bandwidthSeries = bollingerBandwidthSeries(closes);
  const bollingerBandwidth = lastValue(bandwidthSeries);
  const bollingerBaselineBandwidth = median(bandwidthSeries.slice(-61, -1));
  const bollingerBandwidthRatio = relativeRatio(
    bollingerBandwidth,
    bollingerBaselineBandwidth,
  );

  if (
    atr14 == null ||
    atrPercent == null ||
    atrBaselinePercent == null ||
    atrRatio == null ||
    adx == null ||
    bollingerBandwidth == null ||
    bollingerBaselineBandwidth == null ||
    bollingerBandwidthRatio == null
  ) {
    return unknownResult(candles.length, "indicator_calculation_failed");
  }

  const volumes = volumeMetrics(candles);
  const directionalSpread = Math.abs(adx.pdi - adx.mdi);
  const trending =
    adx.adx >= MARKET_REGIME_THRESHOLDS.adxTrendingMinimum &&
    directionalSpread >= MARKET_REGIME_THRESHOLDS.directionalSpreadMinimum;
  const highVolatility =
    (atrRatio >= MARKET_REGIME_THRESHOLDS.highAtrRatio &&
      bollingerBandwidthRatio >=
        MARKET_REGIME_THRESHOLDS.highBollingerBandwidthRatio) ||
    atrRatio >= MARKET_REGIME_THRESHOLDS.extremeVolatilityRatio ||
    bollingerBandwidthRatio >= MARKET_REGIME_THRESHOLDS.extremeVolatilityRatio;
  const lowLiquidity =
    volumes.volumeCoverage >= MARKET_REGIME_THRESHOLDS.minimumVolumeCoverage &&
    volumes.volumeRatio != null &&
    volumes.volumeRatio <= MARKET_REGIME_THRESHOLDS.lowVolumeRatio &&
    !highVolatility;

  const trendDirection: MarketTrendDirection =
    directionalSpread < MARKET_REGIME_THRESHOLDS.directionalSpreadMinimum
      ? "neutral"
      : adx.pdi > adx.mdi
        ? "bullish"
        : "bearish";
  const regime: NumericMarketRegime = highVolatility
    ? "high_volatility"
    : lowLiquidity
      ? "low_liquidity"
      : trending
        ? "trending"
        : "ranging";

  const reasons = highVolatility
    ? ["normalized_volatility_expansion"]
    : lowLiquidity
      ? ["recent_volume_contraction"]
      : trending
        ? ["adx_directional_trend"]
        : ["no_trend_or_volatility_expansion"];

  return {
    regime,
    trendDirection,
    candleCount: candles.length,
    metrics: {
      atr14: round(atr14),
      atrPercent: round(atrPercent, 10),
      atrBaselinePercent: round(atrBaselinePercent, 10),
      atrRatio: round(atrRatio, 6),
      adx14: round(adx.adx, 6),
      plusDi14: round(adx.pdi, 6),
      minusDi14: round(adx.mdi, 6),
      bollingerBandwidth: round(bollingerBandwidth, 10),
      bollingerBaselineBandwidth: round(bollingerBaselineBandwidth, 10),
      bollingerBandwidthRatio: round(bollingerBandwidthRatio, 6),
      ...volumes,
    },
    signals: { trending, highVolatility, lowLiquidity },
    reasons,
    thresholds: MARKET_REGIME_THRESHOLDS,
  };
}
