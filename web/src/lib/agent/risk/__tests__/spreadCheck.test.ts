import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSpreadTooHigh, slippageRisk } from "@/lib/agent/risk/spreadCheck";

/**
 * Scalp/execution spread + slippage gates. These are honest about MISSING data:
 * an unavailable (non-positive) spread is never treated as "good" by fabricating
 * a value — it simply isn't flagged, and the higher-level scalp gate still
 * prefers WAIT on stale/closed sessions. Verified here as pure logic.
 */
describe("isSpreadTooHigh", () => {
  it("flags a wide spread relative to ATR", () => {
    assert.equal(isSpreadTooHigh({ spread: 0.5, atr: 1, stopDistance: 10 }), true);
  });

  it("flags a wide spread relative to stop distance", () => {
    assert.equal(isSpreadTooHigh({ spread: 3, atr: 100, stopDistance: 10 }), true);
  });

  it("accepts a tight spread", () => {
    assert.equal(isSpreadTooHigh({ spread: 0.05, atr: 1, stopDistance: 10 }), false);
  });

  it("does NOT fabricate a value when spread is unavailable (<= 0)", () => {
    // Unavailable spread must not read as 'too high' NOR invent a good spread —
    // it is simply not flagged here; the scalp session/freshness gate governs.
    assert.equal(isSpreadTooHigh({ spread: 0, atr: 1, stopDistance: 10 }), false);
    assert.equal(isSpreadTooHigh({ spread: -1, atr: 1, stopDistance: 10 }), false);
  });
});

describe("slippageRisk", () => {
  it("blocks on high news + wide spread", () => {
    assert.equal(
      slippageRisk({ newsRisk: "high", spreadTooHigh: true, marketJustOpened: false }),
      "block",
    );
  });

  it("warns on high-impact news alone", () => {
    assert.equal(
      slippageRisk({ newsRisk: "high", spreadTooHigh: false, marketJustOpened: false }),
      "warn",
    );
  });

  it("warns just after the session opens", () => {
    assert.equal(
      slippageRisk({ newsRisk: "low", spreadTooHigh: false, marketJustOpened: true }),
      "warn",
    );
  });

  it("is clean in calm, tight-spread conditions", () => {
    assert.equal(
      slippageRisk({ newsRisk: "low", spreadTooHigh: false, marketJustOpened: false }),
      "none",
    );
  });

  it("treats unknown news conservatively (not a clean pass when spread is wide)", () => {
    assert.equal(
      slippageRisk({ newsRisk: "unknown", spreadTooHigh: true, marketJustOpened: false }),
      "warn",
    );
  });
});
