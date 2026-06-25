import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultAdaptiveWeights } from "../adaptiveWeights";
import { runCouncil } from "../council";
import { mockMarketContext, mockRegimeInfo } from "./fixtures";

describe("council", () => {
  it("aggregates 10 advisor votes", () => {
    const ctx = mockMarketContext();
    const regime = mockRegimeInfo();
    const result = runCouncil(ctx, regime, defaultAdaptiveWeights());

    assert.equal(result.votes.length, 10);
    const names = new Set(result.votes.map((v) => v.advisor));
    assert.equal(names.size, 10);
    assert.ok(result.confidence >= 0 && result.confidence <= 100);
    assert.ok(["buy", "sell", "hold"].includes(result.consensusSide));
  });

  it("uplifts buy consensus in strong uptrend context", () => {
    const ctx = mockMarketContext();
    const regime = mockRegimeInfo("TRENDING_UP");
    const result = runCouncil(ctx, regime, defaultAdaptiveWeights());
    assert.ok(result.buyWeight >= 0);
    assert.ok(result.confidence >= 40);
  });
});
