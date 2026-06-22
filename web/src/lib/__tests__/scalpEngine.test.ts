import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evalScalpStop } from "@/lib/scalpEngine";

const base = {
  masterKill: false,
  executedCount: 0,
  maxTrades: 5,
  dailyLossLimitPct: 5,
  todayPnlPct: 0,
  market: "crypto" as const,
  brokerConnected: true,
};

describe("evalScalpStop — autonomous scalp auto-stop guards", () => {
  it("no violation → null (session keeps running)", () => {
    assert.equal(evalScalpStop(base), null);
  });

  it("master kill stops first (highest priority)", () => {
    assert.equal(
      evalScalpStop({ ...base, masterKill: true, executedCount: 99 }),
      "master_kill",
    );
  });

  it("reaching the trade cap stops", () => {
    assert.equal(
      evalScalpStop({ ...base, executedCount: 5, maxTrades: 5 }),
      "max_trades_reached",
    );
  });

  it("daily loss beyond limit stops", () => {
    assert.equal(
      evalScalpStop({ ...base, dailyLossLimitPct: 5, todayPnlPct: -6 }),
      "daily_loss_limit",
    );
    // within limit → keep running
    assert.equal(
      evalScalpStop({ ...base, dailyLossLimitPct: 5, todayPnlPct: -4 }),
      null,
    );
  });

  it("forex broker disconnect stops; crypto ignores broker conn", () => {
    assert.equal(
      evalScalpStop({ ...base, market: "forex", brokerConnected: false }),
      "broker_disconnected",
    );
    assert.equal(
      evalScalpStop({ ...base, market: "crypto", brokerConnected: false }),
      null,
    );
  });

  it("limit of 0 disables the daily-loss guard", () => {
    assert.equal(
      evalScalpStop({ ...base, dailyLossLimitPct: 0, todayPnlPct: -50 }),
      null,
    );
  });
});
