import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeRegimeProbabilities, detectRegime } from "../regimeProbability";
import { MARKET_REGIMES } from "../types";
import { mockMarketContext } from "./fixtures";

describe("regimeProbability", () => {
  it("returns probabilities that sum to 100", () => {
    const ctx = mockMarketContext();
    const probs = computeRegimeProbabilities(ctx);
    const sum = MARKET_REGIMES.reduce((s, k) => s + probs[k], 0);
    assert.equal(sum, 100);
  });

  it("detectRegime picks dominant state with metadata", () => {
    const ctx = mockMarketContext();
    const probs = computeRegimeProbabilities(ctx);
    const info = detectRegime(ctx, probs);
    assert.ok(info.confidence >= 0 && info.confidence <= 100);
    assert.equal(info.probabilities[info.dominant], info.confidence);
    assert.ok(info.strength >= 0);
  });
});
