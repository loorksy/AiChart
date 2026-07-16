import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BridgeErrorCode } from "@/lib/bridge/errors";
import { collectTradeReadinessBlockers, isForexSessionOpen, type TradeReadinessChecks } from "@/lib/bridge/tradeReadiness";

function checks(overrides: Partial<TradeReadinessChecks> = {}): TradeReadinessChecks {
  return {
    connection: { online: true, backend: "mt_ea" },
    heartbeat: { fresh: true, lastHeartbeatAt: "2026-01-01", applies: true },
    quote: { fresh: true, quoteAgeMs: 1, source: "live", spreadPips: 1, maxSpreadPips: 30, staleThresholdMs: 5000, tickStale: false, applies: true },
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
    assert.deepEqual(collectTradeReadinessBlockers({ checks: value, symbol: "EURUSD", forexQuoteGateFailure: null }), []);
  });

  it("blocks missing technical execution authorization", () => {
    const blockers = collectTradeReadinessBlockers({ checks: checks({ executionAuthorization: { allowed: false } }), symbol: "EURUSD", forexQuoteGateFailure: null });
    assert.ok(blockers.some((item) => item.code === BridgeErrorCode.EXECUTION_UNAUTHORIZED));
  });

  it("passes through a technical stale-quote failure", () => {
    const failure = { ok: false as const, error: { code: BridgeErrorCode.STALE_QUOTE, message: "stale", message_ar: "stale", retriable: true } };
    const blockers = collectTradeReadinessBlockers({ checks: checks(), symbol: "EURUSD", forexQuoteGateFailure: failure });
    assert.ok(blockers.some((item) => item.code === BridgeErrorCode.STALE_QUOTE));
  });
});
