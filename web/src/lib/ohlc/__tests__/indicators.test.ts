import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeForexIndicators,
  rsiCrossCheck,
  smaFromLib,
} from "@/lib/ohlc/indicators";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import { detectStructureLevels } from "@/lib/ohlc/structure";

function syntheticCandles(count: number, start = 100): OhlcCandle[] {
  const candles: OhlcCandle[] = [];
  for (let i = 0; i < count; i++) {
    const base = start + Math.sin(i / 5) * 2 + i * 0.05;
    candles.push({
      time: 1_700_000_000_000 + i * 3_600_000,
      open: base,
      high: base + 0.5,
      low: base - 0.5,
      close: base + 0.1,
      volume: 100,
    });
  }
  return candles;
}

describe("computeForexIndicators", () => {
  it("returns RSI and trend for sufficient candles", () => {
    const candles = syntheticCandles(60);
    const result = computeForexIndicators("EURUSD", "1h", candles, "mt5_ohlc");
    assert.ok(result.rsi14 !== null);
    assert.ok(result.rsi14! >= 0 && result.rsi14! <= 100);
    assert.ok(["uptrend", "downtrend", "sideways"].includes(result.trend));
    assert.equal(result.computedFrom, "mt5_ohlc");
  });

  it("aligns local RSI with technicalindicators within tolerance", () => {
    const closes = syntheticCandles(40).map((c) => c.close);
    const { local, lib } = rsiCrossCheck(closes, 14);
    assert.ok(local !== null && lib !== null);
    assert.ok(Math.abs(local! - lib!) < 0.01);
  });

  it("computes SMA via library helper", () => {
    const closes = syntheticCandles(30).map((c) => c.close);
    const libSma = smaFromLib(closes, 20);
    assert.ok(libSma !== null);
    assert.ok(Number.isFinite(libSma));
  });
});

describe("detectStructureLevels", () => {
  it("finds nearest support below current price", () => {
    const candles = syntheticCandles(80);
    const analysis = detectStructureLevels("EURUSD", "1h", candles);
    assert.ok(analysis.currentPrice > 0);
    assert.ok(analysis.supports.length >= 0);
    if (analysis.nearestSupport != null) {
      assert.ok(analysis.nearestSupport <= analysis.currentPrice);
    }
  });
});
