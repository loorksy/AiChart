import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compositionFallback,
  scanForInternalLeakage,
  scrubInternalIdentifiers,
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

  it("only claims a confidence nudge when one was actually applied", () => {
    const base = bundle({
      historicalEvidenceTendency: 0.04,
      contributions: [
        {
          system: "trading_dna",
          status: "used",
          reason: "strength_support",
          reasonDetail: "n=40",
          evidenceTendency: 0.04,
        },
      ],
      usedSystems: ["trading_dna"],
    });
    const claimed = toUserSafeResearchProjection(base, {
      confidenceNudgeApplied: 0.04,
    });
    assert.ok(
      claimed.notes.some((n) => /nudged confidence slightly higher/i.test(n)),
    );
    const clampedAway = toUserSafeResearchProjection(base, {
      confidenceNudgeApplied: 0,
    });
    assert.ok(
      !clampedAway.notes.some((n) => /nudged confidence/i.test(n)),
      JSON.stringify(clampedAway.notes),
    );
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

  describe("scrubInternalIdentifiers (leakage policy, outbound layer)", () => {
    it("removes env-var names, keys, provider hosts, model slugs and URLs", () => {
      const dirty =
        "I use OPENAI_API_KEY with sk-abc123def456ghi789 against " +
        "https://api.openai.com/v1/chat and api.anthropic.com running " +
        "gpt-4o and claude-sonnet-4 via OPENROUTER_BASE_URL.";
      const clean = scrubInternalIdentifiers(dirty);
      assert.doesNotMatch(clean, /OPENAI_API_KEY/);
      assert.doesNotMatch(clean, /sk-abc123/);
      assert.doesNotMatch(clean, /openai\.com/);
      assert.doesNotMatch(clean, /anthropic\.com/);
      assert.doesNotMatch(clean, /gpt-4o/i);
      assert.doesNotMatch(clean, /claude-sonnet/i);
      assert.doesNotMatch(clean, /OPENROUTER_BASE_URL/);
    });

    it("removes stack frames and repo file paths", () => {
      const dirty =
        "Error: boom\n" +
        "    at runAgent (src/lib/agent/orchestrator.ts:100:5)\n" +
        "    at /app/node_modules/next/dist/server.js:1:1\n" +
        "see src/lib/agent/webTurn.ts for details";
      const clean = scrubInternalIdentifiers(dirty);
      assert.doesNotMatch(clean, /orchestrator\.ts/);
      assert.doesNotMatch(clean, /node_modules/);
      assert.doesNotMatch(clean, /webTurn\.ts/);
    });

    it("preserves market vocabulary — XAUUSD, OANDA, prices, Arabic", () => {
      const line =
        "قرأت 240 شمعة على XAUUSD فريم 1h — السعر 4651.38، البيانات من OANDA، الهدف TP1 عند 4688.25";
      assert.equal(scrubInternalIdentifiers(line), line);
    });
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
        dataSource: "oanda",
      },
    } as AgentFinalResult);
    assert.equal(result.researchEvidence, undefined);
    assert.equal(result.evidenceTimeline, undefined);
    assert.equal(result.selectedSkills, undefined);
    assert.equal(result.debugDecisionFlow, undefined);
    assert.equal(result.summary, "Buy setup");
  });
});
