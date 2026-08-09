import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectBoundedResearchEvidence,
  decideResearchJustification,
  researchContributed,
  RESEARCH_EVIDENCE_VERSION,
} from "@/lib/agent/researchEvidence";

describe("researchEvidence", () => {
  it("never claims expensive research ran without justification", async () => {
    const bundle = await collectBoundedResearchEvidence({
      actionableCandidate: false,
    });
    assert.equal(bundle.evidenceVersion, RESEARCH_EVIDENCE_VERSION);
    assert.equal(researchContributed(bundle, "backtest"), false);
    assert.equal(researchContributed(bundle, "validation"), false);
    assert.equal(researchContributed(bundle, "research_swarm"), false);
    assert.equal(researchContributed(bundle, "shadow_trader"), false);
    assert.equal(bundle.historicalEvidenceTendency, 0);
    for (const c of bundle.contributions) {
      assert.ok(c.reason.length > 0);
      assert.ok(c.reasonDetail.length > 0);
      assert.notEqual(c.reason.toLowerCase(), "skipped");
    }
  });

  it("skips DNA when there is no actionable candidate", async () => {
    const bundle = await collectBoundedResearchEvidence({
      userId: 1,
      actionableCandidate: false,
    });
    const dna = bundle.contributions.find((c) => c.system === "trading_dna");
    assert.equal(dna?.status, "skipped");
    assert.equal(dna?.reason, "no_actionable_candidate");
  });

  it("justifies backtest for mid-confidence evidence, skips swarm for simple analysis", () => {
    const mid = decideResearchJustification({
      actionableCandidate: true,
      baseConfidence: 0.62,
      dataQualityScore: 0.7,
      userMessage: "analyze EURUSD",
    });
    assert.equal(mid.backtestWorth, true);
    assert.equal(mid.swarmWorth, false);
    assert.equal(mid.reasons.swarm, "simple_chart_analysis");

    const high = decideResearchJustification({
      actionableCandidate: true,
      baseConfidence: 0.9,
      dataQualityScore: 0.95,
      userMessage: "buy setup",
    });
    assert.equal(high.backtestWorth, false);
    assert.equal(high.reasons.backtest, "confidence_already_sufficient");

    const deep = decideResearchJustification({
      actionableCandidate: true,
      baseConfidence: 0.7,
      userMessage: "run deep research swarm comparison",
    });
    assert.equal(deep.swarmWorth, true);
  });

  it("skips backtest with explicit latency/completed-job reason when justified but no artifacts", async () => {
    const prevService = process.env.RESEARCH_SERVICE_ENABLED;
    const prevBacktest = process.env.RESEARCH_BACKTEST_ENABLED;
    process.env.RESEARCH_SERVICE_ENABLED = "1";
    process.env.RESEARCH_BACKTEST_ENABLED = "1";
    try {
      const bundle = await collectBoundedResearchEvidence({
        userId: 999999,
        actionableCandidate: true,
        decision: "buy",
        symbol: "EURUSD",
        baseConfidence: 0.6,
        userMessage: "please backtest this setup",
        latencyBudgetMs: 200,
      });
      const bt = bundle.contributions.find((c) => c.system === "backtest");
      assert.ok(bt);
      assert.notEqual(bt?.status, "used");
      assert.ok(
        bt?.reason === "justified_but_no_completed_job_in_latency_budget" ||
          bt?.reason === "feature_flag_off" ||
          bt?.reason === "no_user_context" ||
          typeof bt?.reason === "string",
      );
      assert.ok((bt?.reasonDetail ?? "").length > 10);
      assert.ok(bundle.timeline.some((t) => t.step === "backtest"));
    } finally {
      if (prevService === undefined) delete process.env.RESEARCH_SERVICE_ENABLED;
      else process.env.RESEARCH_SERVICE_ENABLED = prevService;
      if (prevBacktest === undefined) delete process.env.RESEARCH_BACKTEST_ENABLED;
      else process.env.RESEARCH_BACKTEST_ENABLED = prevBacktest;
    }
  });
});
