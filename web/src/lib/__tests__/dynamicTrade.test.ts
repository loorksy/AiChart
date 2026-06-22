import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveDynamicStops } from "@/lib/dynamicStops";
import { deriveDynamicNotional } from "@/lib/dynamicSizing";

describe("deriveDynamicStops — adaptive, no fixed template", () => {
  it("buy: SL below, TP above; sell: mirrored", () => {
    const buy = deriveDynamicStops({ entry: 100, side: "buy", style: "balanced", confidence: 60, atr: 2 })!;
    assert.ok(buy.stopLoss < 100 && buy.takeProfit > 100);
    const sell = deriveDynamicStops({ entry: 100, side: "sell", style: "balanced", confidence: 60, atr: 2 })!;
    assert.ok(sell.stopLoss > 100 && sell.takeProfit < 100);
  });

  it("higher volatility (ATR) widens the stop", () => {
    const lo = deriveDynamicStops({ entry: 100, side: "buy", style: "balanced", confidence: 50, atr: 1 })!;
    const hi = deriveDynamicStops({ entry: 100, side: "buy", style: "balanced", confidence: 50, atr: 4 })!;
    assert.ok(100 - hi.stopLoss > 100 - lo.stopLoss);
  });

  it("falls back to rangePct when ATR is null (still valid)", () => {
    const s = deriveDynamicStops({ entry: 100, side: "buy", style: "aggressive", confidence: 50, atr: null, rangePct: 0.05 });
    assert.ok(s && s.stopLoss < 100 && s.takeProfit > 100);
  });

  it("higher confidence raises R:R", () => {
    const lo = deriveDynamicStops({ entry: 100, side: "buy", style: "balanced", confidence: 40, atr: 2 })!;
    const hi = deriveDynamicStops({ entry: 100, side: "buy", style: "balanced", confidence: 90, atr: 2 })!;
    assert.ok(hi.rr > lo.rr);
  });

  it("invalid entry → null", () => {
    assert.equal(deriveDynamicStops({ entry: 0, side: "buy", style: "balanced", confidence: 50, atr: 2 }), null);
  });
});

describe("deriveDynamicNotional — adaptive, never static, always clamped", () => {
  const base = { baseNotional: 100, riskFraction: 0.01, maxNotional: 150 };

  it("higher confidence → larger size (within cap)", () => {
    const lo = deriveDynamicNotional({ ...base, confidence: 50 });
    const hi = deriveDynamicNotional({ ...base, confidence: 95 });
    assert.ok(hi > lo);
    assert.ok(hi <= 150);
  });

  it("higher volatility (riskFraction) → smaller size", () => {
    const calm = deriveDynamicNotional({ ...base, confidence: 70, riskFraction: 0.01 });
    const wild = deriveDynamicNotional({ ...base, confidence: 70, riskFraction: 0.04 });
    assert.ok(wild < calm);
  });

  it("existing exposure shrinks size", () => {
    const none = deriveDynamicNotional({ ...base, confidence: 70, exposureFraction: 0 });
    const heavy = deriveDynamicNotional({ ...base, confidence: 70, exposureFraction: 1 });
    assert.ok(heavy < none);
  });

  it("never exceeds the hard ceiling or base*1.5", () => {
    const n = deriveDynamicNotional({ baseNotional: 100, confidence: 100, riskFraction: 0.001, maxNotional: 120 });
    assert.ok(n <= 120);
  });
});
