import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDirectionalOpinionOnly,
  trackedRecommendationFromResult,
} from "@/lib/recommendations/fromAgentResult";
import { recommendationClockAnchor } from "@/lib/agent/recommendationExpiry";
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
    // The validity clock starts at the ANCHOR — now mid-session, the next
    // open on a weekend. Measuring from createdAt described the bug this
    // replaced: a Saturday plan born already expired. These assertions hold
    // under a live clock in both regimes.
    const anchor = recommendationClockAnchor("XAUUSD", tracked!.createdAt);
    // 12 one-minute candles of validity — not born expired.
    assert.ok(tracked!.expiresAt >= anchor + 11 * 60_000);
    // Scalp ceiling is 30m — candle window must not outlive it.
    assert.ok(tracked!.expiresAt <= anchor + 30 * 60_000);
    assert.equal(tracked!.status, "pending_entry");
  });

  it("caps 1h chat-card expiry with the timeframe ceiling, not raw candles×interval", () => {
    const tracked = trackedRecommendationFromResult(
      baseResult({
        activeRecommendation: {
          id: "rec-1h",
          status: "pending_entry",
          direction: "buy",
          symbol: "EURUSD",
          interval: "1h",
        },
        recommendation: {
          action: "buy",
          entry: 1.1,
          entryType: "buy_limit",
          stop_loss: 1.09,
          targets: [1.12],
          validityCandles: 96,
          activationClass: "conditional",
        },
      }),
    );
    assert.ok(tracked);
    // 96×1h would be 4 days; 1h ceiling is 36h — measured from the session
    // anchor, not the wall clock (see the scalp test above).
    const anchor = recommendationClockAnchor("EURUSD", tracked!.createdAt);
    assert.ok(tracked!.expiresAt <= anchor + 36 * 60 * 60_000);
    assert.ok(tracked!.expiresAt > tracked!.createdAt);
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

describe("recommendationClockAnchor", () => {
  it("is the identity mid-session", () => {
    const tuesdayOpen = Date.parse("2026-07-21T22:30:00Z"); // Tue 18:30 NY
    assert.equal(recommendationClockAnchor("XAUUSD", tuesdayOpen), tuesdayOpen);
  });

  it("moves a Saturday clock to Sunday's open, so a weekend plan is not born expired", () => {
    const saturday = Date.parse("2026-07-25T12:00:00Z");
    const anchor = recommendationClockAnchor("XAUUSD", saturday);
    assert.equal(anchor, Date.parse("2026-07-26T22:00:00Z"));
    // The point of the whole exercise: validity counted from the anchor ends
    // AFTER the market has actually traded, not 46 hours before it opens.
    assert.ok(anchor > saturday);
  });
});
