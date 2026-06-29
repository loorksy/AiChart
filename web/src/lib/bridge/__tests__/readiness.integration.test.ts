import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BridgeErrorCode } from "@/lib/bridge/errors";
import {
  collectTradeReadinessBlockers,
  confidenceGateCheck,
  isForexSessionOpen,
} from "@/lib/bridge/tradeReadiness";
import type { TradingSettings } from "@/lib/types";

const baseSettings = {
  min_confidence: 80,
} as Pick<TradingSettings, "min_confidence">;

describe("confidenceGateCheck", () => {
  it("passes when confidence omitted (informational)", () => {
    const gate = confidenceGateCheck(
      { min_confidence: 80 } as TradingSettings,
      { resolvedEnv: "live" },
    );
    assert.equal(gate.passes, true);
    assert.equal(gate.minConfidence, 0);
  });

  it("passes when confidence is below 80 on live since gate is eliminated", () => {
    const gate = confidenceGateCheck(
      { min_confidence: 80 } as TradingSettings,
      { resolvedEnv: "live" },
      75,
    );
    assert.equal(gate.passes, true);
  });
});

describe("isForexSessionOpen", () => {
  it("marks Saturday UTC as closed", () => {
    const sat = new Date("2026-06-20T12:00:00.000Z");
    assert.equal(isForexSessionOpen(sat).open, false);
  });

  it("marks mid-week UTC as open", () => {
    const wed = new Date("2026-06-17T12:00:00.000Z");
    assert.equal(isForexSessionOpen(wed).open, true);
  });
});

describe("collectTradeReadinessBlockers", () => {
  it("does not block low confidence when supplied", () => {
    const confidenceGate = confidenceGateCheck(
      baseSettings as TradingSettings,
      { resolvedEnv: "live" },
      75,
    );
    const blockers = collectTradeReadinessBlockers({
      checks: {
        eaOnline: {
          online: true,
          missedHeartbeats: 0,
          settledOnlineSeconds: 10,
          applies: false,
        },
        heartbeat: { fresh: true, lastHeartbeatAt: null, applies: false },
        quote: {
          fresh: true,
          quoteAgeMs: null,
          source: null,
          spreadPips: null,
          maxSpreadPips: 30,
          staleThresholdMs: 5000,
          tickStale: false,
          applies: false,
        },
        canExecute: { allowed: true },
        openTrades: { count: 0, max: 3, passes: true },
        dailyLoss: { todayPnlPct: 0, limitPct: 5, passes: true },
        monthlyLoss: { monthPnlPct: 0, limitPct: 15, passes: true },
        forexSession: { open: true, applies: false },
        confidenceGate,
      },
      forexApplies: false,
      symbol: null,
      heartbeatFresh: true,
      eaOnline: true,
      forexQuoteGateFailure: null,
      openCount: 0,
      maxOpen: 3,
      dailyLossLimitPct: 5,
      monthlyLossLimitPct: 15,
    });

    assert.equal(
      blockers.some((b) => b.code === BridgeErrorCode.LOW_CONFIDENCE),
      false,
    );
  });

  it("adds stale quote blocker for forex", () => {
    const blockers = collectTradeReadinessBlockers({
      checks: {
        eaOnline: {
          online: true,
          missedHeartbeats: 0,
          settledOnlineSeconds: 10,
          applies: true,
        },
        heartbeat: { fresh: true, lastHeartbeatAt: "2026-01-01", applies: true },
        quote: {
          fresh: false,
          quoteAgeMs: 9000,
          source: "stale",
          spreadPips: 1,
          maxSpreadPips: 30,
          staleThresholdMs: 5000,
          tickStale: false,
          applies: true,
        },
        canExecute: { allowed: true },
        openTrades: { count: 0, max: 3, passes: true },
        dailyLoss: { todayPnlPct: 0, limitPct: 5, passes: true },
        monthlyLoss: { monthPnlPct: 0, limitPct: 15, passes: true },
        forexSession: { open: true, applies: true },
        confidenceGate: { minConfidence: 80, passes: true },
      },
      forexApplies: true,
      symbol: "EURUSD",
      heartbeatFresh: true,
      eaOnline: true,
      forexQuoteGateFailure: {
        ok: false,
        error: {
          code: BridgeErrorCode.STALE_QUOTE,
          message: "Quote age exceeds threshold.",
          message_ar: "السعر قديم — انتظر تحديث الأسعار.",
          retriable: true,
        },
      },
      openCount: 0,
      maxOpen: 3,
      dailyLossLimitPct: 5,
      monthlyLossLimitPct: 15,
    });

    assert.ok(blockers.some((b) => b.code === BridgeErrorCode.STALE_QUOTE));
  });
});
