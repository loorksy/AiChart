import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import {
  detectNumericMarketRegime,
  MARKET_REGIME_THRESHOLDS,
} from "@/lib/ohlc/marketRegime";

const START = 1_700_000_000_000;

function candlesFromCloses(
  closes: number[],
  options: {
    padding?: (index: number) => number;
    volume?: (index: number) => number | undefined;
  } = {},
): OhlcCandle[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    const padding = options.padding?.(index) ?? 0.00025;
    return {
      time: START + index * 60_000,
      open,
      high: Math.max(open, close) + padding,
      low: Math.min(open, close) - padding,
      close,
      volume: options.volume?.(index) ?? 100,
    };
  });
}

function trendingCandles(count = 140): OhlcCandle[] {
  return candlesFromCloses(
    Array.from({ length: count }, (_, index) => 1.05 + index * 0.00035),
  );
}

function rangingCandles(count = 140, volume?: (index: number) => number): OhlcCandle[] {
  return candlesFromCloses(
    Array.from({ length: count }, (_, index) => 1.1 + Math.sin(index * 0.72) * 0.0012),
    { volume },
  );
}

function volatilityExpansionCandles(): OhlcCandle[] {
  const closes = Array.from({ length: 140 }, (_, index) => {
    if (index < 115) return 1.1 + Math.sin(index * 0.45) * 0.00035;
    return 1.1 + (index % 2 === 0 ? 1 : -1) * (0.004 + (index - 115) * 0.00025);
  });
  return candlesFromCloses(closes, {
    padding: (index) => (index < 115 ? 0.00015 : 0.0015),
  });
}

describe("detectNumericMarketRegime", () => {
  it("returns unknown until the deterministic indicator window is available", () => {
    const result = detectNumericMarketRegime(
      trendingCandles(MARKET_REGIME_THRESHOLDS.minimumCandles - 1),
    );
    assert.equal(result.regime, "unknown");
    assert.deepEqual(result.reasons, ["insufficient_candles"]);
  });

  it("classifies a directional ADX move as trending", () => {
    const result = detectNumericMarketRegime(trendingCandles());
    assert.equal(result.regime, "trending");
    assert.equal(result.trendDirection, "bullish");
    assert.equal(result.signals.trending, true);
    assert.ok((result.metrics.adx14 ?? 0) >= MARKET_REGIME_THRESHOLDS.adxTrendingMinimum);
    assert.ok(result.metrics.atr14 != null);
    assert.ok(result.metrics.bollingerBandwidth != null);
  });

  it("classifies a stable oscillating market as ranging", () => {
    const result = detectNumericMarketRegime(rangingCandles());
    assert.equal(result.regime, "ranging");
    assert.equal(result.signals.highVolatility, false);
    assert.equal(result.signals.lowLiquidity, false);
  });

  it("prioritizes ATR and Bollinger expansion as high volatility", () => {
    const result = detectNumericMarketRegime(volatilityExpansionCandles());
    assert.equal(result.regime, "high_volatility");
    assert.equal(result.signals.highVolatility, true);
    assert.ok(
      (result.metrics.atrRatio ?? 0) >= MARKET_REGIME_THRESHOLDS.highAtrRatio ||
        (result.metrics.bollingerBandwidthRatio ?? 0) >=
          MARKET_REGIME_THRESHOLDS.extremeVolatilityRatio,
    );
  });

  it("uses covered tick-volume contraction for low liquidity", () => {
    const result = detectNumericMarketRegime(
      rangingCandles(140, (index) => (index >= 130 ? 10 : 100)),
    );
    assert.equal(result.regime, "low_liquidity");
    assert.equal(result.signals.lowLiquidity, true);
    assert.equal(result.metrics.volumeCoverage, 1);
    assert.ok((result.metrics.volumeRatio ?? 1) <= MARKET_REGIME_THRESHOLDS.lowVolumeRatio);
  });

  it("is deterministic for identical candle evidence", () => {
    const candles = volatilityExpansionCandles();
    assert.deepEqual(
      detectNumericMarketRegime(candles),
      detectNumericMarketRegime(candles),
    );
  });
});
