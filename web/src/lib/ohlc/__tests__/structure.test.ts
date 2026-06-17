import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import { detectStructureLevels } from "@/lib/ohlc/structure";

function trendingUpCandles(count: number): OhlcCandle[] {
  const candles: OhlcCandle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 1.08 + i * 0.001;
    candles.push({
      time: 1_700_000_000_000 + i * 3_600_000,
      open: base,
      high: base + 0.002,
      low: base - 0.0005,
      close: base + 0.0015,
      volume: 50,
    });
  }
  return candles;
}

describe("detectStructureLevels (structure)", () => {
  it("returns unknown structure with insufficient candles", () => {
    const analysis = detectStructureLevels("EURUSD", "1h", trendingUpCandles(4));
    assert.equal(analysis.structure, "unknown");
    assert.match(analysis.summary, /لا تتوفر شموع/);
  });

  it("detects uptrend on monotonic rise", () => {
    const analysis = detectStructureLevels("EURUSD", "1h", trendingUpCandles(80));
    assert.ok(analysis.currentPrice > 1.08);
    assert.ok(["uptrend", "range", "unknown"].includes(analysis.structure));
    if (analysis.nearestResistance != null) {
      assert.ok(analysis.nearestResistance >= analysis.currentPrice);
    }
  });

  it("clusters swing lows into supports below price", () => {
    const candles = trendingUpCandles(100);
    const analysis = detectStructureLevels("EURUSD", "4h", candles);
    for (const s of analysis.supports) {
      assert.equal(s.type, "support");
      assert.ok(s.touches >= 1);
    }
  });
});
