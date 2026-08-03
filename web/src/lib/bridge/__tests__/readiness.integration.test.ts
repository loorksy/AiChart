import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BridgeErrorCode } from "@/lib/bridge/errors";
import { collectTradeReadinessBlockers, isForexSessionOpen, type TradeReadinessChecks } from "@/lib/bridge/tradeReadiness";

function checks(overrides: Partial<TradeReadinessChecks> = {}): TradeReadinessChecks {
  return {
    connection: { online: true, backend: "metaapi" },
    heartbeat: { fresh: true, lastHeartbeatAt: null, applies: false },
    quote: { fresh: true, quoteAgeMs: null, source: null, spreadPips: null, maxSpreadPips: 30, staleThresholdMs: 5000, tickStale: false, applies: false },
    executionAuthorization: { allowed: true },
    forexSession: { open: true },
    ...overrides,
  };
}

describe("technical trade readiness", () => {
  it("uses the real forex session calendar", () => {
    assert.equal(isForexSessionOpen(new Date("2026-06-20T12:00:00Z")).open, false);
    assert.equal(isForexSessionOpen(new Date("2026-06-17T12:00:00Z")).open, true);
  });

  it("does not contain confidence, loss, or open-trade policy checks", () => {
    const value = checks();
    assert.equal("confidenceGate" in value, false);
    assert.equal("dailyLoss" in value, false);
    assert.equal("openTrades" in value, false);
    assert.deepEqual(collectTradeReadinessBlockers({ checks: value, symbol: "EURUSD" }), []);
  });

  it("blocks missing technical execution authorization", () => {
    const blockers = collectTradeReadinessBlockers({ checks: checks({ executionAuthorization: { allowed: false } }), symbol: "EURUSD" });
    assert.ok(blockers.some((item) => item.code === BridgeErrorCode.EXECUTION_UNAUTHORIZED));
  });

  it("blocks a disconnected account", () => {
    const blockers = collectTradeReadinessBlockers({
      checks: checks({ connection: { online: false, backend: "metaapi" } }),
      symbol: "EURUSD",
    });
    assert.ok(blockers.some((item) => item.code === BridgeErrorCode.CONNECTION_OFFLINE));
  });
});
