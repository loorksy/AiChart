import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultAdaptiveWeights } from "../adaptiveWeights";
import { runCouncil } from "../council";
import { assessDanger } from "../dangerEngine";
import { makeDecision } from "../decisionEngine";
import { computeInstitutionalScore } from "../institutionalScore";
import { scoreTradeQuality } from "../tradeQualityEngine";
import { DEFAULT_GOLD_AGENTX_CONFIG } from "../../goldDefaults";
import { mockMarketContext, mockRegimeInfo } from "./fixtures";

describe("decisionEngine triple gate", () => {
  it("blocks entry when confidence, quality, or score below 60", () => {
    const danger = assessDanger(mockMarketContext(), mockRegimeInfo());
    const blocked = makeDecision({
      council: {
        votes: [],
        consensusSide: "buy",
        confidence: 55,
        buyWeight: 100,
        sellWeight: 0,
        holdWeight: 0,
      },
      tradeQuality: 55,
      tradeScore: 55,
      config: DEFAULT_GOLD_AGENTX_CONFIG,
      effectiveMinConfidence: 60,
      danger,
      hasPosition: false,
    });
    assert.equal(blocked.action, "HOLD");
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.blockReason, "triple_gate");
  });

  it("allows BUY when all scores >= 60 and danger normal", () => {
    const ctx = mockMarketContext();
    const regime = mockRegimeInfo("TRENDING_UP");
    const council = runCouncil(ctx, regime, defaultAdaptiveWeights());
    const quality = scoreTradeQuality(ctx, regime, council);
    const institutional = computeInstitutionalScore(
      ctx,
      regime,
      council,
      quality,
      DEFAULT_GOLD_AGENTX_CONFIG,
    );
    const danger = assessDanger(ctx, regime);

    const boostedCouncil = {
      ...council,
      confidence: Math.max(council.confidence, 65),
      consensusSide: "buy" as const,
    };
    const boostedQuality = Math.max(quality.score, 65);
    const boostedScore = Math.max(institutional.score, 65);

    const decision = makeDecision({
      council: boostedCouncil,
      tradeQuality: boostedQuality,
      tradeScore: boostedScore,
      config: DEFAULT_GOLD_AGENTX_CONFIG,
      effectiveMinConfidence: 60,
      danger,
      hasPosition: false,
    });

    assert.ok(decision.confidence >= 60);
    assert.ok(decision.tradeQuality >= 60);
    assert.ok(decision.tradeScore >= 60);
    assert.equal(decision.action, "BUY");
    assert.equal(decision.side, "buy");
  });

  it("blocks all entries on EXTREME_DANGER", () => {
    const ctx = mockMarketContext({
      quote: { bid: 2650, ask: 2655, spread: 5, mid: 2652.5 },
      tickVelocity: 50,
    });
    const regime = mockRegimeInfo("NEWS_REACTION");
    regime.probabilities.NEWS_REACTION = 50;
    regime.probabilities.VOLATILE = 40;
    const danger = assessDanger(ctx, regime);

    if (danger.level === "EXTREME_DANGER") {
      const decision = makeDecision({
        council: {
          votes: [],
          consensusSide: "buy",
          confidence: 90,
          buyWeight: 100,
          sellWeight: 0,
          holdWeight: 0,
        },
        tradeQuality: 90,
        tradeScore: 90,
        config: DEFAULT_GOLD_AGENTX_CONFIG,
        effectiveMinConfidence: 60,
        danger,
        hasPosition: false,
      });
      assert.equal(decision.action, "HOLD");
      assert.equal(decision.blockReason, "danger");
    }
  });
});
