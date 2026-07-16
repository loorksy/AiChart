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
});
