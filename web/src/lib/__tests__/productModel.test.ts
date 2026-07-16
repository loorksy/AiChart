import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RISK_PER_TRADE, normalizeRiskPerTrade, riskPerTradeSchema, TRADING_STYLE } from "@/lib/productModel";

describe("simplified product model", () => {
  it("exposes scalping as a fixed invariant", () => {
    assert.equal(TRADING_STYLE, "scalp");
  });

  it("accepts only Risk per Trade values on the 0.1 step", () => {
    assert.equal(riskPerTradeSchema.safeParse(0.1).success, true);
    assert.equal(riskPerTradeSchema.safeParse(5).success, true);
    assert.equal(riskPerTradeSchema.safeParse(0).success, false);
    assert.equal(riskPerTradeSchema.safeParse(5.1).success, false);
    assert.equal(riskPerTradeSchema.safeParse(1.25).success, false);
  });

  it("normalizes stored legacy values safely", () => {
    assert.equal(normalizeRiskPerTrade("bad"), RISK_PER_TRADE.default);
    assert.equal(normalizeRiskPerTrade(-2), RISK_PER_TRADE.default);
    assert.equal(normalizeRiskPerTrade(12), RISK_PER_TRADE.default);
    assert.equal(normalizeRiskPerTrade(1.24), 1.2);
  });
});
