/**
 * Lifecycle / race-condition contracts for Deep Analysis completion.
 * These tests prove the control-flow guards without requiring a live Research Service.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreCompletedResearchJob } from "@/lib/agent/deepAnalysis/completion";
import { decideDeepAnalysisTrigger } from "@/lib/agent/deepAnalysis/triggers";
import { buildGeneralizableStrategySpec } from "@/lib/agent/deepAnalysis/strategySpec";

describe("deepAnalysis race and lifecycle contracts", () => {
  it("duplicate deep-analysis fingerprints are idempotent at strategy level", () => {
    const a = buildGeneralizableStrategySpec({
      symbol: "GBPUSD",
      timeframe: "1h",
      direction: "sell",
      marketRegime: "downtrend",
      zoneType: "supply",
      confirmationRule: "breakout_retest",
      atr: 0.002,
      entry: 1.3,
      stopLoss: 1.304,
      targets: [1.294],
    });
    const b = buildGeneralizableStrategySpec({
      symbol: "GBPUSD",
      timeframe: "1h",
      direction: "sell",
      marketRegime: "downtrend",
      zoneType: "supply",
      confirmationRule: "breakout_retest",
      atr: 0.002,
      entry: 1.3,
      stopLoss: 1.304,
      targets: [1.294],
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) assert.equal(a.fingerprint, b.fingerprint);
  });

  it("research failure scoring leaves confidence unchanged (original decision intact)", () => {
    const failed = scoreCompletedResearchJob({ status: "failed", result_summary: null });
    assert.equal(failed.delta, 0);
    const empty = scoreCompletedResearchJob({
      status: "succeeded",
      result_summary: "",
    });
    assert.equal(empty.delta, 0);
  });

  it("completion never implies execution — trigger matrix cannot override safety", () => {
    const blocked = decideDeepAnalysisTrigger({
      decision: "buy",
      confidence: 0.7,
      hardSafetyOrLiveDataFailure: true,
      hardFailureCode: "execution_guard_rejection",
      historicalConfirmationInsufficient: true,
      userMessage: "deep analysis now",
    });
    assert.equal(blocked.run, false);
    assert.ok(
      (blocked.reasons ?? []).some((r) =>
        r.includes("cannot_override_safety"),
      ),
    );
  });

  it("scoreCompletedResearchJob never treats job presence as a confidence bonus", () => {
    const presence = scoreCompletedResearchJob({
      status: "succeeded",
      result_summary: "completed successfully with artifacts",
    });
    assert.equal(presence.delta, 0);
    assert.equal(presence.metricsPresent, false);
  });
});
