import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateTradeSetup } from "@/lib/agent/risk/validateTradeSetup";

const base = { currentPrice: 100, htfConflict: false, newsRisk: "low" as const, dataSufficient: true };

describe("validateTradeSetup evidence annotations", () => {
  it("rejects only invalid numeric level geometry", () => {
    const result = validateTradeSetup({ ...base, trade: { action: "buy", entry: 100, stop_loss: 101, targets: [102] } });
    assert.equal(result.accepted, false);
  });

  it("does not reject high news risk", () => {
    const result = validateTradeSetup({ ...base, newsRisk: "high", trade: { action: "buy", entry: 100, stop_loss: 99, targets: [100.2] } });
    assert.equal(result.accepted, true);
    assert.ok(result.warnings.length > 0);
    assert.ok((result.rr ?? 0) < 1);
  });

  it("does not reject limited data coverage", () => {
    const result = validateTradeSetup({ ...base, dataSufficient: false, coverageDetail: "limited", trade: { action: "sell", entry: 100, stop_loss: 101, targets: [99] } });
    assert.equal(result.accepted, true);
    assert.ok(result.warnings.includes("limited"));
  });

  it("accepts WAIT without inventing levels", () => {
    assert.equal(validateTradeSetup({ ...base, trade: { action: "wait" } }).accepted, true);
  });
});
