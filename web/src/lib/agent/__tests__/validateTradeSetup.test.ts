import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateTradeSetup } from "@/lib/agent/risk/validateTradeSetup";

const base = {
  currentPrice: 100,
  atr: 1,
  spread: 0.1,
  hasValidPoi: true,
  htfConflict: false,
  newsRisk: "low" as const,
  dataSufficient: true,
};

describe("validateTradeSetup", () => {
  it("rejects a buy that violates SL < entry < TP", () => {
    const r = validateTradeSetup({
      ...base,
      trade: { action: "buy", entry: 100, stop_loss: 101, targets: [102] },
    });
    assert.equal(r.accepted, false);
  });

  it("rejects a sell that violates TP < entry < SL", () => {
    const r = validateTradeSetup({
      ...base,
      trade: { action: "sell", entry: 100, stop_loss: 99, targets: [98] },
    });
    assert.equal(r.accepted, false);
  });

  it("high news risk blocks the trade", () => {
    const r = validateTradeSetup({
      ...base,
      newsRisk: "high",
      trade: { action: "buy", entry: 100, stop_loss: 99, targets: [103] },
    });
    assert.equal(r.accepted, false);
    assert.ok(r.reasons.some((x) => x.toLowerCase().includes("news")));
  });

  it("accepts a valid buy with RR >= 1.5", () => {
    const r = validateTradeSetup({
      ...base,
      trade: { action: "buy", entry: 100, stop_loss: 99, targets: [102] },
    });
    assert.equal(r.accepted, true);
    assert.ok((r.rr ?? 0) >= 1.5);
  });

  it("rejects weak reward:risk below the minimum", () => {
    const r = validateTradeSetup({
      ...base,
      trade: { action: "buy", entry: 100, stop_loss: 99, targets: [100.5] },
    });
    assert.equal(r.accepted, false);
  });

  it("rejects entry == current price without a valid POI", () => {
    const r = validateTradeSetup({
      ...base,
      hasValidPoi: false,
      trade: { action: "buy", entry: 100, stop_loss: 99, targets: [102] },
    });
    assert.equal(r.accepted, false);
  });

  it("wait is always accepted (no trade requested)", () => {
    const r = validateTradeSetup({ ...base, trade: { action: "wait" } });
    assert.equal(r.accepted, true);
  });

  it("rejects insufficient candle coverage with explicit detail when provided", () => {
    const r = validateTradeSetup({
      ...base,
      dataSufficient: false,
      coverageDetail: "WAIT — 15m: 64/500 (refill: +18, partial).",
      trade: { action: "buy", entry: 100, stop_loss: 99, targets: [102] },
    });
    assert.equal(r.accepted, false);
    assert.ok(r.reasons.some((x) => x.includes("64/500")));
  });
});
