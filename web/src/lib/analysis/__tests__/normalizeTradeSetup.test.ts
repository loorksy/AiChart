import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveMinRrForStyle,
  normalizeTradeSetup,
} from "../normalizeTradeSetup";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";

function candle(i: number, close: number): OhlcCandle {
  return {
    time: 1_700_000_000 + i * 300,
    open: close - 10,
    high: close + 20,
    low: close - 30,
    close,
    volume: 100,
  };
}

/** Uptrend with pullback toward support trendline. */
function sampleCandles(): OhlcCandle[] {
  const out: OhlcCandle[] = [];
  for (let i = 0; i < 25; i++) {
    const base = 62_000 + i * 15;
    out.push(candle(i, base));
  }
  out.push(candle(25, 62_520));
  out.push(candle(26, 62_480));
  return out;
}

describe("normalizeTradeSetup", () => {
  it("requires 20+ candles for scalp", () => {
    const candles = sampleCandles().slice(0, 15);
    const r = normalizeTradeSetup({
      action: "buy",
      entry: 62_500,
      stopLoss: 62_400,
      targets: [62_600],
      candles,
      atr: 200,
      trendlines: null,
      structure: null,
      minRr: 1.5,
      tradingStyle: "scalp",
    });
    assert.equal(r.action, "wait");
    assert.ok(r.issue?.includes("20"));
  });

  it("extends TP to meet min R:R (profit zone larger than loss)", () => {
    const candles = sampleCandles();
    const r = normalizeTradeSetup({
      action: "buy",
      entry: 62_500,
      stopLoss: 62_400,
      targets: [62_520],
      candles,
      atr: 200,
      trendlines: null,
      structure: null,
      minRr: 1.5,
      tradingStyle: "day",
    });
    assert.equal(r.action, "buy");
    assert.ok(r.entry != null && r.stopLoss != null && r.targets[0] != null);
    const risk = r.entry! - r.stopLoss!;
    const reward = r.targets[0]! - r.entry!;
    assert.ok(reward >= risk * 1.5 - 1);
  });

  it("rejects buy when entry chases far above support trendline", () => {
    const candles = sampleCandles();
    const trendlines = {
      support: {
        kind: "support" as const,
        from: { index: 0, price: 62000, kind: "low" as const },
        to: { index: 20, price: 62400, kind: "low" as const },
        slopePerBar: 20,
        projectedNow: 62400,
      },
      resistance: null,
      drawings: [],
    };
    const r = normalizeTradeSetup({
      action: "buy",
      entry: 63_000,
      stopLoss: 62_800,
      targets: [63_200],
      candles,
      atr: 150,
      trendlines,
      structure: null,
      minRr: 1.5,
      tradingStyle: "scalp",
    });
    assert.equal(r.action, "wait");
    assert.ok(r.issue?.includes("POI") || r.issue?.includes("خط") || r.issue?.includes("بعيد"));
  });

  it("effectiveMinRrForStyle floors scalp at 1.5", () => {
    assert.equal(effectiveMinRrForStyle(1, "scalp"), 1.5);
    assert.equal(effectiveMinRrForStyle(2, "scalp"), 2);
  });
});
