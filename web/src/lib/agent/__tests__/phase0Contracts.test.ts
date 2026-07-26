/**
 * Phase-0 static contracts (RELIABILITY_PLAN.md): source-level guards that
 * lock the reliability wiring the unit tests cannot reach without heavy
 * mocking. Same style as phase4Contracts / integrationBoundaries.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const orchestrator = readFileSync(
  new URL("../orchestrator.ts", import.meta.url),
  "utf8",
);
const streamRoute = readFileSync(
  new URL("../../../app/api/agent/chat/stream/route.ts", import.meta.url),
  "utf8",
);
const analyzeRoute = readFileSync(
  new URL("../../../app/api/agent/market/analyze/route.ts", import.meta.url),
  "utf8",
);

describe("SSE stream failure contract (phase-0 SLO)", () => {
  it("a crashed run emits a COMPLETE final event before the legacy error event", () => {
    const catchBlock = streamRoute.slice(streamRoute.indexOf("} catch (error) {"));
    const finalSend = catchBlock.indexOf('send("final"');
    const errorSend = catchBlock.indexOf('send("error"');
    assert.ok(finalSend > 0, "the catch path must emit a final event");
    assert.ok(errorSend > 0, "the legacy error event must remain for old clients");
    assert.ok(finalSend < errorSend, "final must be emitted before error");
    assert.match(catchBlock, /buildAgentFallbackResult/);
    assert.match(catchBlock, /operational|failureStage:\s*"transport"/);
  });

  it("the error payload never carries the raw provider error message", () => {
    assert.doesNotMatch(
      streamRoute,
      /send\("error",\s*\{\s*error:\s*error instanceof Error/,
      "raw error.message must never reach the client",
    );
    const catchBlock = streamRoute.slice(streamRoute.indexOf("} catch (error) {"));
    assert.match(catchBlock, /userMessageForFailure/);
  });
});

describe("orchestrator envelope wiring", () => {
  it("keeps the guaranteed-envelope wrapper as the contract backstop", () => {
    assert.match(orchestrator, /if \(!result\.envelope\)/);
    assert.match(orchestrator, /result\.envelope = descriptiveEnvelope\(/);
  });

  it("market-data stops are labelled operational blockers, never descriptive", () => {
    // Every hard market-data stop (unavailable, sync fail ×2, gap stop ×2)
    // must construct a blocker explicitly instead of falling through to the
    // wrapper's descriptive default (which would re-enable usage charging).
    const blockers = orchestrator.match(/operationalBlockerEnvelope\(\{/g) ?? [];
    assert.ok(
      blockers.length >= 5,
      `expected >=5 explicit blocker envelopes, found ${blockers.length}`,
    );
    assert.match(orchestrator, /failureStage:\s*"market_data",\s*\n?\s*failureCode:\s*"stale_data"/);
    assert.match(orchestrator, /failureCode:\s*"insufficient_data"/);
  });

  it("silent stage deadlines are ledgered for every fleet member and news", () => {
    for (const stage of ["structure", "liquidity", "supply_demand", "multi_timeframe", "news"]) {
      assert.ok(
        orchestrator.includes(`ledgerSilentTimeout(stageFailures, "${stage}"`),
        `silent timeout for stage "${stage}" must be ledgered`,
      );
    }
  });
});

describe("market-analyze accounting contract", () => {
  it("usage is charged only for non-blocker outcomes", () => {
    assert.match(analyzeRoute, /const charged = shouldChargeAnalysis\(result\.envelope\)/);
    assert.match(analyzeRoute, /if \(charged\) await incrementUsage\(userId, ANALYSIS_COST\)/);
    // No unconditional charge may survive anywhere in the route.
    assert.doesNotMatch(analyzeRoute, /^\s*await incrementUsage\(/m);
  });

  it("applied_to_chart reflects the real save result and surfaces failures", () => {
    assert.match(analyzeRoute, /applied_to_chart:\s*appliedToChart/);
    assert.doesNotMatch(analyzeRoute, /applied_to_chart:\s*true/);
    assert.match(analyzeRoute, /layout_save_failed/);
    assert.doesNotMatch(analyzeRoute, /saveChartLayout\([\s\S]{0,400}?\.catch\(\(\) => \{\}\)/);
  });

  it("a null recommendation always carries a qualitative reason", () => {
    assert.match(analyzeRoute, /recommendation_reason:\s*deriveRecommendationReason/);
  });

  it("quota math uses the actual charge, not the nominal cost", () => {
    assert.match(analyzeRoute, /used:\s*used \+ chargeAmount/);
    assert.match(analyzeRoute, /limits\.claude_quota - used - chargeAmount/);
  });
});
