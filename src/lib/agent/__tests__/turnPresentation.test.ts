/**
 * Turn presentation contract — cards are contextual, never constant.
 *
 * The regression this pins: a greeting rendered the full recommendation-status
 * card (the "no recommendation now" hero with a 0% strength meter and a "what
 * was the plan?" button), a decision header, and a chip stack. The contract is
 * decided ONCE in turnPresentation.ts and consumed by both the panel and the
 * card renderer; these tests pin the decision table plus the source-level
 * wiring on the two consumers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  isPlainTalkResult,
  type TurnPresentationInput,
} from "@/lib/agent/turnPresentation";

const blockerEnvelope = {
  outcome_class: "operational_blocker",
} as unknown as TurnPresentationInput["envelope"];
const analysisEnvelope = {
  outcome_class: "analysis",
} as unknown as TurnPresentationInput["envelope"];

describe("isPlainTalkResult — the mode decides", () => {
  it("conversation and specialist turns render as plain talk", () => {
    assert.equal(isPlainTalkResult({ turnMode: "conversation", decision: "informational" }), true);
    assert.equal(isPlainTalkResult({ turnMode: "specialist", decision: "informational" }), true);
  });

  it("analysis and follow-up turns keep their cards", () => {
    for (const turnMode of [
      "full_analysis",
      "supersede_analysis",
      "recommendation_followup",
    ] as const) {
      assert.equal(
        isPlainTalkResult({ turnMode, decision: "informational" }),
        false,
        `${turnMode} must keep cards`,
      );
    }
  });

  it("an operational blocker keeps its fault card regardless of mode", () => {
    assert.equal(
      isPlainTalkResult({
        turnMode: "conversation",
        decision: "informational",
        envelope: blockerEnvelope,
      }),
      false,
    );
  });

  it("a conversational turn with a NON-blocker envelope still renders plain", () => {
    assert.equal(
      isPlainTalkResult({
        turnMode: "conversation",
        decision: "informational",
        envelope: analysisEnvelope,
      }),
      true,
    );
  });

  it("no result at all is not plain talk (nothing to decide)", () => {
    assert.equal(isPlainTalkResult(null), false);
    assert.equal(isPlainTalkResult(undefined), false);
  });
});

describe("isPlainTalkResult — legacy results without turnMode", () => {
  const bare: TurnPresentationInput = { decision: "informational" };

  it("a bare informational answer renders plain", () => {
    assert.equal(isPlainTalkResult(bare), true);
  });

  it("anything analysis-shaped keeps its cards — doubt keeps the dashboard", () => {
    const analysisShaped: TurnPresentationInput[] = [
      { ...bare, decision: "buy" },
      { ...bare, recommendation: { direction: "buy" } as never },
      { ...bare, activeRecommendation: { id: "r1" } as never },
      { ...bare, gateVerdicts: [{ id: "G1" }] as never },
      { ...bare, marketClosedScenario: {} as never },
      { ...bare, evidenceCard: {} as never },
      { ...bare, evidenceDimensions: [{}] as never },
    ];
    for (const result of analysisShaped) {
      assert.equal(isPlainTalkResult(result), false, JSON.stringify(result));
    }
  });
});

describe("consumers obey the contract (source wiring)", () => {
  const panel = readFileSync(
    join(__dirname, "../../../components/agent/SmartChartAgentPanel.tsx"),
    "utf8",
  );
  const cards = readFileSync(
    join(__dirname, "../../../components/agent/cards/AgentCards.tsx"),
    "utf8",
  );
  const webTurn = readFileSync(join(__dirname, "../webTurn.ts"), "utf8");

  it("the panel gates the decision header and presentation facts by mode", () => {
    assert.match(panel, /isPlainTalkResult/);
    // The per-message compliance badge is GONE; the disclaimer lives once
    // under the composer.
    assert.doesNotMatch(panel, /AgentModeBadge/);
    assert.match(panel, /agent-compliance-footnote/);
    // Assistant turns are signed by the avatar instead.
    assert.match(panel, /<AgentAvatar/);
  });

  it("the card renderer suppresses the card stack for plain-talk turns", () => {
    assert.match(cards, /isPlainTalkResult/);
    assert.match(cards, /data-plain-talk/);
  });

  it("the server skips suggestion chips for conversation turns", () => {
    assert.match(webTurn, /turnMode === "conversation"/);
  });
});
