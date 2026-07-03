import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfidence } from "../confidence.js";

describe("normalizeConfidence", () => {
  it("scales decimal fractions to 0-100", () => {
    assert.equal(normalizeConfidence(0.87), 87);
    assert.equal(normalizeConfidence(0.01), 1);
  });

  it("keeps integer percentages", () => {
    assert.equal(normalizeConfidence(87), 87);
    assert.equal(normalizeConfidence(100), 100);
  });

  it("clamps out-of-range values", () => {
    assert.equal(normalizeConfidence(-5), 0);
    assert.equal(normalizeConfidence(150), 100);
    assert.equal(normalizeConfidence(Number.NaN), 0);
  });

  it("treats 1 as 100 only in decimal scale (0-1)", () => {
    assert.equal(normalizeConfidence(1), 100);
  });
});
