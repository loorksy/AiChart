/**
 * Visual-review single source of truth.
 *
 * Production failure: the thinking line said "reviewed 3 frames" while the
 * report showed BOTH "visual.line.verified_frames" AND the evidence row
 * "لم تُراجَع لقطات الشارت … غير متاح". Two writers, two answers. These
 * tests pin one writer: captured snapshots ⇒ every surface says reviewed
 * with those timeframes; no snapshots ⇒ every surface says not reviewed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  visualReviewFromEvidence,
  type VisualEvidenceResult,
} from "@/lib/agent/visualEvidence";
import {
  applyVisualReviewDimension,
  buildEvidenceDimensions,
  type BuildEvidenceDimensionsInput,
} from "@/lib/agent/evidenceDimensions";
import { visualTransparencyLine } from "@/lib/recommendations/visualTransparency";
import { deriveCards } from "@/lib/agent/cards/deriveCards";
import { renderCardsForTelegram } from "@/lib/agent/cards/telegramCards";
import type { AgentFinalResult } from "@/lib/agent/types";

const NOT_REVIEWED = /لم تُراجَع لقطات الشارت|غير متاح|not_checked|not reviewed|numeric analysis only/i;

function snapshots(
  frames: string[],
): VisualEvidenceResult["snapshots"] {
  return frames.map((timeframe) => ({
    timeframe,
    imageBase64: "x",
  })) as VisualEvidenceResult["snapshots"];
}

function dims(over: Partial<BuildEvidenceDimensionsInput> = {}) {
  return buildEvidenceDimensions({
    planType: "immediate",
    executionState: "valid_now",
    signalStrength: 0.6,
    dataSufficient: true,
    ...over,
  }).dimensions;
}

function buyResult(over: Partial<AgentFinalResult> = {}): AgentFinalResult {
  return {
    decision: "buy",
    summary: "شراء.",
    confidence: 0.6,
    keyReasons: [],
    riskWarnings: [],
    activityEvents: [],
    recommendation: {
      action: "buy",
      entry: 4000,
      stop_loss: 3980,
      targets: [4040],
    } as AgentFinalResult["recommendation"],
    ...over,
  } as AgentFinalResult;
}

describe("visualReviewFromEvidence is the single writer", () => {
  it("captured frames → confirmed with those timeframes", () => {
    const review = visualReviewFromEvidence({
      snapshots: snapshots(["5m", "15m", "1h"]),
    });
    assert.equal(review.state, "confirmed");
    assert.deepEqual(review.timeframes, ["5m", "15m", "1h"]);
  });

  it("no frames → not_checked", () => {
    const review = visualReviewFromEvidence({ snapshots: [] });
    assert.equal(review.state, "not_checked");
    assert.deepEqual(review.timeframes, []);
  });
});

describe("if verified, the report cannot say not-reviewed / غير متاح", () => {
  it("transparency line, evidence row, and telegram agree on reviewed frames", () => {
    const review = visualReviewFromEvidence({
      snapshots: snapshots(["5m", "15m", "1h"]),
    });
    const line = visualTransparencyLine({
      state: review.state,
      timeframesReviewed: review.timeframes,
    });
    const visualDim = dims({
      visualConfirmation: review.state,
      visualTimeframes: review.timeframes,
    }).find((d) => d.key === "visual_review")!;

    assert.match(line, /TradingView/);
    assert.match(line, /5m/);
    assert.doesNotMatch(line, NOT_REVIEWED);
    assert.equal(visualDim.grade, "strong");
    assert.match(visualDim.detail, /5m/);
    assert.doesNotMatch(visualDim.detail, /لم تُراجَع/);
    assert.notEqual(visualDim.grade, "unavailable");

    const cards = deriveCards(
      buyResult({
        visualReview: review,
        evidenceDimensions: [visualDim],
      }),
    );
    const visualCard = cards.find((c) => c.kind === "visual_review");
    assert.equal(visualCard && visualCard.kind === "visual_review" && visualCard.state, "confirmed");
    const tg = renderCardsForTelegram(cards, "ar");
    assert.match(tg, /TradingView/);
    assert.doesNotMatch(tg, /لم تُلتقط لقطة شارت/);
  });

  it("applyVisualReviewDimension overwrites a stale not-reviewed row", () => {
    const stale = dims({ visualConfirmation: "not_checked" });
    const staleVisual = stale.find((d) => d.key === "visual_review")!;
    assert.match(staleVisual.detail, /لم تُراجَع/);

    const fixed = applyVisualReviewDimension(stale, {
      state: "confirmed",
      timeframes: ["5m", "15m", "1h"],
    });
    const visual = fixed.find((d) => d.key === "visual_review")!;
    assert.equal(visual.grade, "strong");
    assert.doesNotMatch(visual.detail, /لم تُراجَع/);
    assert.match(visual.detail, /15m/);
    // The leftover "غير متاح" grade must not sit next to a reviewed row.
    assert.notEqual(visual.grade, "unavailable");
  });

  it("a blind run stays not-reviewed on every surface", () => {
    const review = visualReviewFromEvidence({ snapshots: [] });
    const line = visualTransparencyLine({ state: review.state });
    const visualDim = dims({ visualConfirmation: review.state }).find(
      (d) => d.key === "visual_review",
    )!;
    assert.match(line, /رقمية/);
    assert.equal(visualDim.grade, "unavailable");
    assert.match(visualDim.detail, /لم تُراجَع/);
  });
});

describe("the orchestrator uses one writer for every surface", () => {
  it("wires visualReviewFromEvidence and applyVisualReviewDimension", () => {
    const orch = readFileSync(join(__dirname, "../orchestrator.ts"), "utf8");
    assert.match(orch, /visualReviewFromEvidence/);
    assert.match(orch, /applyVisualReviewDimension/);
    assert.doesNotMatch(
      orch,
      /state: visual\.visuallyVerified \? \("confirmed"/,
      "must not branch visualReview.state off drawings_included-gated visuallyVerified",
    );
  });

  it("collector treats captured images as reviewed", () => {
    const src = readFileSync(join(__dirname, "../visualEvidence.ts"), "utf8");
    assert.match(src, /const visuallyVerified = snapshots\.length > 0/);
  });
});
