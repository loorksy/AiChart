import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDirectionalOpinionOnly,
  trackedRecommendationFromResult,
} from "@/lib/recommendations/fromAgentResult";
import type { AgentFinalResult } from "@/lib/agent/types";

function baseResult(
  over: Partial<AgentFinalResult> = {},
): AgentFinalResult {
  return {
    decision: "sell",
    confidence: 0.7,
    summary: "test",
    keyReasons: [],
    riskWarnings: [],
    activityEvents: [],
    recommendationId: "rec-1",
    activeRecommendation: {
      id: "rec-1",
      status: "pending_entry",
      direction: "sell",
      symbol: "XAUUSD",
      interval: "1m",
    },
    ...over,
  };
}

describe("trackedRecommendationFromResult", () => {
  it("marks distant conditional setups as waiting for entry", () => {
    const tracked = trackedRecommendationFromResult(
      baseResult({
        recommendation: {
          action: "sell",
          entry: 3981.67,
          entryType: "sell_limit",
          stop_loss: 3986,
          targets: [3975, 3970],
          rr: 2.6,
          netRr: 2.6,
          activationClass: "conditional",
          triggerCondition: "wait for retest",
        },
      }),
    );
    assert.ok(tracked);
    assert.equal(tracked!.status, "pending_entry");
    assert.equal(tracked!.activationClass, "conditional");
    assert.equal(tracked!.triggeredAt, undefined);
  });

  it("does not build a tracker card for directional opinion only", () => {
    const result = baseResult({
      recommendation: { action: "sell" },
    });
    assert.equal(trackedRecommendationFromResult(result), null);
    assert.equal(isDirectionalOpinionOnly(result), true);
  });

  it("marks immediate market entries as triggered", () => {
    const tracked = trackedRecommendationFromResult(
      baseResult({
        recommendation: {
          action: "buy",
          entry: 100,
          entryType: "market",
          stop_loss: 98,
          targets: [105],
          activationClass: "immediate",
          netRr: 2.5,
        },
      }),
    );
    assert.ok(tracked);
    assert.equal(tracked!.status, "triggered");
    assert.ok(tracked!.triggeredAt);
  });

  it("threads plan type, execution state, current price and a real expiry", () => {
    const tracked = trackedRecommendationFromResult(
      baseResult({
        evidenceSnapshot: {
          modelContext: { currentPrice: 3999.5, symbol: "XAUUSD", interval: "1m" },
        },
        recommendation: {
          action: "sell",
          entry: 3981.67,
          entryType: "sell_limit",
          stop_loss: 3986,
          targets: [3975],
          planType: "conditional",
          executionState: "awaiting_activation",
          validityCandles: 12,
          entryZone: { low: 3980, high: 3983 },
        },
      }),
    );
    assert.ok(tracked);
    assert.equal(tracked!.planType, "conditional");
    assert.equal(tracked!.executionState, "awaiting_activation");
    assert.equal(tracked!.priceAtCreation, 3999.5);
    assert.equal(tracked!.entryLow, 3980);
    assert.equal(tracked!.entryHigh, 3983);
    // 12 one-minute candles of validity — not born expired.
    assert.ok(tracked!.expiresAt >= tracked!.createdAt + 11 * 60_000);
    assert.equal(tracked!.status, "pending_entry");
  });

  it("execution state outranks a market entry type for the initial status", () => {
    const tracked = trackedRecommendationFromResult(
      baseResult({
        recommendation: {
          action: "buy",
          entry: 100,
          entryType: "market",
          stop_loss: 98,
          targets: [105],
          planType: "anticipatory",
          executionState: "awaiting_activation",
        },
      }),
    );
    assert.ok(tracked);
    assert.equal(tracked!.status, "pending_entry");
    assert.equal(tracked!.triggeredAt, undefined);
    assert.equal(tracked!.planType, "anticipatory");
  });

  it("falls back to the evidence snapshot for symbol/interval and derives a plan type", () => {
    const tracked = trackedRecommendationFromResult(
      baseResult({
        activeRecommendation: undefined,
        recommendationId: "rec-9",
        evidenceSnapshot: {
          modelContext: { symbol: "EURUSD", interval: "5m", currentPrice: 1.093 },
        },
        recommendation: {
          action: "buy",
          entry: 1.09,
          entryType: "market",
          stop_loss: 1.088,
          targets: [1.095],
        },
      }),
    );
    assert.ok(tracked);
    assert.equal(tracked!.symbol, "EURUSD");
    assert.equal(tracked!.interval, "5m");
    assert.equal(tracked!.priceAtCreation, 1.093);
    assert.equal(tracked!.planType, "immediate");
    assert.ok(tracked!.expiresAt > tracked!.createdAt);
  });
});
