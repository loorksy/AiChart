import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.join(import.meta.dirname, "..", "route.ts"),
  "utf8",
);

describe("create_recommendation has no backtest claim fields", () => {
  it("does not accept or return backtested_confidence, statistical_support, or backtest_evidence", () => {
    assert.doesNotMatch(SRC, /backtested_confidence/);
    assert.doesNotMatch(SRC, /statistical_support/);
    assert.doesNotMatch(SRC, /backtest_evidence/);
    assert.doesNotMatch(SRC, /requireRecommendationEvidence/);
    assert.match(SRC, /model_judgement/);
    assert.match(SRC, /coerceVisualConfirmation/);
  });
});
