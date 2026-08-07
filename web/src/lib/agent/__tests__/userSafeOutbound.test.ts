import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compositionFallback,
  scanForInternalLeakage,
  toUserSafeResearchProjection,
  stripInternalFieldsFromClientResult,
} from "@/lib/agent/userSafeOutbound";
import type { ResearchEvidenceBundle } from "@/lib/agent/researchEvidence";
import type { AgentFinalResult } from "@/lib/agent/types";

function bundle(
  partial: Partial<ResearchEvidenceBundle> & {
    contributions: ResearchEvidenceBundle["contributions"];
  },
): ResearchEvidenceBundle {
  return {
    evidenceVersion: "1.2.0",
    historicalEvidenceTendency: 0,
    summaryAr: "",
    summaryEn: "",
    timeline: [],
    usedSystems: [],
    skippedSystems: [],
    ...partial,
  };
}

describe("userSafeOutbound", () => {
  it("projects internal evidence without module names", () => {
    const projection = toUserSafeResearchProjection(
      bundle({
        historicalEvidenceTendency: 0.04,
        contributions: [
          {
            system: "trading_dna",
            status: "used",
            reason: "strength_support",
            reasonDetail: "n=40 strengths=3",
            evidenceTendency: 0.04,
          },
        ],
        usedSystems: ["trading_dna"],
      }),
    );
    assert.equal(projection.historicalAgreement, "supports");
    assert.equal(projection.evidenceDirection, "supports");
    const serialized = JSON.stringify(projection);
    assert.equal(scanForInternalLeakage(serialized).length, 0);
    assert.doesNotMatch(serialized, /Trading DNA|trading_dna/i);
  });

  it("detects leakage and provides bilingual fallback", () => {
    const hits = scanForInternalLeakage("Used Trading DNA and Backtest job_abc");
    assert.ok(hits.length >= 2);
    const ar = compositionFallback({ locale: "ar", decision: "wait" });
    const en = compositionFallback({ locale: "en", decision: "buy" });
    assert.equal(ar.markedFallback, true);
    assert.equal(en.markedFallback, true);
    assert.equal(scanForInternalLeakage(ar.text).length, 0);
    assert.equal(scanForInternalLeakage(en.text).length, 0);
  });

  it("strips researchEvidence and evidenceTimeline from client payload", () => {
    const result = stripInternalFieldsFromClientResult({
      decision: "buy",
      confidence: 0.7,
      summary: "Buy setup",
      keyReasons: [],
      riskWarnings: [],
      activityEvents: [],
      researchEvidence: bundle({ contributions: [] }),
      evidenceTimeline: [{ step: "backtest", status: "used" }],
      selectedSkills: [{ name: "x", version: "1" }],
      debugDecisionFlow: {
        usedLLM: true,
        tickerGenerated: false,
        candleCount: 1,
        htfCandleCount: 1,
        dailyCandleCount: 1,
        selectedLevelsCount: 0,
        rejectedLevelsCount: 0,
        drawingPlanReason: "none",
        dataSource: "metaapi",
      },
    } as AgentFinalResult);
    assert.equal(result.researchEvidence, undefined);
    assert.equal(result.evidenceTimeline, undefined);
    assert.equal(result.selectedSkills, undefined);
    assert.equal(result.debugDecisionFlow, undefined);
    assert.equal(result.summary, "Buy setup");
  });
});
