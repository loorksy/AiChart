import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveMaxOpenTrades,
  resolveEffectiveCapital,
} from "@/lib/riskLimits";

describe("riskLimits/resolveMaxOpenTrades", () => {
  it("admin cap of 0 means UNLIMITED → the user's own setting governs", () => {
    // Regression: the original bug was Math.min(userMax, 0) === 0, which blocked
    // EVERY trade once the admin cap defaulted to unlimited (0).
    assert.equal(resolveMaxOpenTrades(1, 0), 1);
    assert.equal(resolveMaxOpenTrades(5, 0), 5);
    assert.equal(resolveMaxOpenTrades(1000, 0), 1000);
  });

  it("low-capital conservative edge case ($92-100) is NOT blocked", () => {
    // user_id=2 reality: max_open_trades=1 (conservative default), cap=0.
    // Must resolve to 1 (one trade allowed), never 0 (RISK_LIMIT_EXCEEDED).
    const maxOpen = resolveMaxOpenTrades(1, 0);
    assert.equal(maxOpen, 1);
    assert.ok(maxOpen > 0, "low-capital user must be able to open a trade");
    // The readiness gate is `openCount < maxOpen`; with 0 open trades it passes.
    assert.equal(0 < maxOpen, true);
  });

  it("a negative cap is also treated as unlimited", () => {
    assert.equal(resolveMaxOpenTrades(3, -1), 3);
  });

  it("a positive admin cap is a CEILING (can only lower the user's value)", () => {
    assert.equal(resolveMaxOpenTrades(10, 5), 5); // admin lowers 10 → 5
    assert.equal(resolveMaxOpenTrades(5, 10), 5); // user's lower value wins
    assert.equal(resolveMaxOpenTrades(5, 5), 5);
  });

  it("supports large per-user limits (configurable, multi-user safe)", () => {
    assert.equal(resolveMaxOpenTrades(1_000_000, 0), 1_000_000);
    assert.equal(resolveMaxOpenTrades(1_000_000, 250), 250);
  });

  it("guards against non-finite / fractional inputs", () => {
    assert.equal(resolveMaxOpenTrades(Number.NaN, 0), 0);
    assert.equal(resolveMaxOpenTrades(3.9, 0), 3); // truncates
    assert.equal(resolveMaxOpenTrades(5, Number.NaN), 5); // NaN cap = unlimited
    assert.equal(resolveMaxOpenTrades(-2, 0), 0); // never negative
  });
});

describe("riskLimits/resolveEffectiveCapital", () => {
  it("admin capital cap of 0 means UNLIMITED", () => {
    assert.equal(resolveEffectiveCapital(100, 0), 100);
    assert.equal(resolveEffectiveCapital(100, -5), 100);
  });

  it("a positive capital cap is a ceiling", () => {
    assert.equal(resolveEffectiveCapital(100, 50), 50);
    assert.equal(resolveEffectiveCapital(40, 50), 40);
  });
});
