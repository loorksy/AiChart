import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalStrategySymbol,
  canonicalStrategyTimeframe,
  RESEARCH_TIMEFRAMES,
  storageStrategyTimeframe,
} from "@/lib/strategies/matchingKeys";

describe("canonicalStrategySymbol", () => {
  it("strips broker suffixes and separators to the canonical key", () => {
    assert.equal(canonicalStrategySymbol("XAUUSDM"), "XAUUSD");
    assert.equal(canonicalStrategySymbol("XAUUSDm"), "XAUUSD");
    assert.equal(canonicalStrategySymbol("XAUUSD.pro"), "XAUUSD");
    assert.equal(canonicalStrategySymbol("EUR/USD"), "EURUSD");
    assert.equal(canonicalStrategySymbol("eurusd"), "EURUSD");
    assert.equal(canonicalStrategySymbol("EURUSD"), "EURUSD");
  });
});

describe("canonicalStrategyTimeframe", () => {
  it("accepts the research set verbatim", () => {
    for (const timeframe of RESEARCH_TIMEFRAMES) {
      assert.equal(canonicalStrategyTimeframe(timeframe), timeframe);
    }
  });

  it("maps MT, TV, and loose spellings onto the research set", () => {
    assert.equal(canonicalStrategyTimeframe("H1"), "1h");
    assert.equal(canonicalStrategyTimeframe("h4"), "4h");
    assert.equal(canonicalStrategyTimeframe("M15"), "15m");
    assert.equal(canonicalStrategyTimeframe("D1"), "1d");
    assert.equal(canonicalStrategyTimeframe("60"), "1h");
    assert.equal(canonicalStrategyTimeframe("240"), "4h");
    assert.equal(canonicalStrategyTimeframe("1D"), "1d");
    assert.equal(canonicalStrategyTimeframe("4H"), "4h");
    assert.equal(canonicalStrategyTimeframe("15 min"), "15m");
    assert.equal(canonicalStrategyTimeframe(" 1h "), "1h");
  });

  it("returns null for frames the research engine does not model", () => {
    assert.equal(canonicalStrategyTimeframe("1w"), null);
    assert.equal(canonicalStrategyTimeframe("1M"), null);
    assert.equal(canonicalStrategyTimeframe("2h"), null);
    assert.equal(canonicalStrategyTimeframe("banana"), null);
    assert.equal(canonicalStrategyTimeframe(""), null);
  });

  it("never confuses month with minute", () => {
    assert.equal(canonicalStrategyTimeframe("1m"), "1m");
    assert.equal(canonicalStrategyTimeframe("1M"), null);
  });
});

describe("storageStrategyTimeframe", () => {
  it("canonicalises when mappable and preserves the claim otherwise", () => {
    assert.equal(storageStrategyTimeframe("H1"), "1h");
    assert.equal(storageStrategyTimeframe("1w"), "1w");
    assert.equal(storageStrategyTimeframe("  2h "), "2h");
  });
});

describe("evidence-key regression: the exact production mismatch", () => {
  it("XAUUSDM + '60' produce the same keys a deployment stores (XAUUSD, 1h)", () => {
    // strategy_deployments rows are written with the canonical pair. Before
    // canonicalisation the recommendation stored XAUUSDM/"60" and the exact
    // 4-tuple lookup + execution JOIN could never match.
    assert.equal(canonicalStrategySymbol("XAUUSDM"), "XAUUSD");
    assert.equal(canonicalStrategyTimeframe("60"), "1h");
  });
});
