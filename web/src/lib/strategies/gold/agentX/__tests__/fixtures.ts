/**
 * Test fixtures for Gold Agent X unit tests.
 */
import type { MarketContext, RegimeInfo } from "../types";
import { emptyRegimeProbabilities } from "../types";

export function mockMarketContext(overrides?: Partial<MarketContext>): MarketContext {
  const candles = Array.from({ length: 50 }, (_, i) => ({
    time: i,
    open: 2650 + i * 0.1,
    high: 2651 + i * 0.1,
    low: 2649 + i * 0.1,
    close: 2650.5 + i * 0.1,
  }));

  return {
    symbol: "XAUUSD",
    userId: 1,
    quote: { bid: 2650, ask: 2650.2, spread: 0.2, mid: 2650.1 },
    candles: { M1: candles, M5: candles, M15: candles },
    indicators: {
      M1: {
        symbol: "XAUUSD",
        interval: "M1",
        computedFrom: "mt5_ohlc",
        rsi14: 55,
        macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
        sma20: 2648,
        sma50: 2645,
        ema20: 2649,
        bollinger: { upper: 2660, middle: 2650, lower: 2640 },
        atr14: 2,
        stochastic: { k: 50, d: 50 },
        trend: "uptrend",
        summary: "test",
      },
      M5: {
        symbol: "XAUUSD",
        interval: "M5",
        computedFrom: "mt5_ohlc",
        rsi14: 58,
        macd: { macd: 0.8, signal: 0.4, histogram: 0.4 },
        sma20: 2648,
        sma50: 2645,
        ema20: 2649,
        bollinger: { upper: 2660, middle: 2650, lower: 2640 },
        atr14: 2.5,
        stochastic: { k: 55, d: 52 },
        trend: "uptrend",
        summary: "test",
      },
      M15: {
        symbol: "XAUUSD",
        interval: "M15",
        computedFrom: "mt5_ohlc",
        rsi14: 60,
        macd: { macd: 1, signal: 0.5, histogram: 0.5 },
        sma20: 2647,
        sma50: 2640,
        ema20: 2648,
        bollinger: { upper: 2665, middle: 2650, lower: 2635 },
        atr14: 3,
        stochastic: { k: 58, d: 55 },
        trend: "uptrend",
        summary: "test",
      },
    },
    structure: {
      M5: {
        symbol: "XAUUSD",
        interval: "M5",
        currentPrice: 2650,
        supports: [{ price: 2640, type: "support", touches: 2, lastIndex: 10 }],
        resistances: [{ price: 2660, type: "resistance", touches: 2, lastIndex: 20 }],
        nearestSupport: 2640,
        nearestResistance: 2660,
        swingHighs: [2655, 2658, 2660],
        swingLows: [2642, 2645, 2648],
        structure: "uptrend",
        summary: "uptrend",
      },
      M15: {
        symbol: "XAUUSD",
        interval: "M15",
        currentPrice: 2650,
        supports: [{ price: 2635, type: "support", touches: 3, lastIndex: 10 }],
        resistances: [{ price: 2665, type: "resistance", touches: 2, lastIndex: 20 }],
        nearestSupport: 2635,
        nearestResistance: 2665,
        swingHighs: [2655, 2660, 2665],
        swingLows: [2635, 2640, 2645],
        structure: "uptrend",
        summary: "uptrend",
      },
    },
    tickVelocity: 0.5,
    timestamp: Date.now(),
    session: { session: "LONDON", quality: 80, utcHour: 10 },
    correlation: { dxy: null, us10y: null, vix: null },
    ...overrides,
  };
}

export function mockRegimeInfo(dominant: RegimeInfo["dominant"] = "TRENDING_UP"): RegimeInfo {
  const probabilities = emptyRegimeProbabilities();
  probabilities[dominant] = 78;
  probabilities.RANGE = 12;
  probabilities.VOLATILE = 10;
  return {
    dominant,
    probabilities,
    confidence: 78,
    strength: 65,
    persistence: 70,
  };
}
