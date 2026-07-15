import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectBoundedResearchEvidence,
  researchContributed,
  RESEARCH_EVIDENCE_POLICY_VERSION,
} from "@/lib/agent/researchEvidence";

describe("researchEvidence", () => {
  it("never claims expensive research ran without justification", async () => {
    const bundle = await collectBoundedResearchEvidence({
      actionableCandidate: false,
    });
    assert.equal(bundle.policyVersion, RESEARCH_EVIDENCE_POLICY_VERSION);
    assert.equal(researchContributed(bundle, "backtest"), false);
    assert.equal(researchContributed(bundle, "validation"), false);
    assert.equal(researchContributed(bundle, "research_swarm"), false);
    assert.equal(researchContributed(bundle, "shadow_trader"), false);
    assert.equal(bundle.recommendationConfidenceDelta, 0);
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
});
