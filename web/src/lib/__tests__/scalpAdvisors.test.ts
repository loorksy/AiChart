import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldEnter,
  scalpConfidenceThreshold,
} from "@/lib/scalpAdvisors";

describe("scalp confidence gate", () => {
  it("enters only when decision=enter AND confidence ≥ threshold", () => {
    assert.equal(shouldEnter({ decision: "enter", confidence: 70 }, 65), true);
    assert.equal(shouldEnter({ decision: "enter", confidence: 60 }, 65), false);
    assert.equal(shouldEnter({ decision: "skip", confidence: 99 }, 65), false);
  });

  it("threshold tightens with conservative style", () => {
    assert.ok(
      scalpConfidenceThreshold("conservative") >
        scalpConfidenceThreshold("balanced"),
    );
    assert.ok(
      scalpConfidenceThreshold("balanced") >=
        scalpConfidenceThreshold("aggressive"),
    );
  });
});
