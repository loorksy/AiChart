import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBrokerForexSuffix,
  toCanonicalForexSymbol,
} from "../forexSymbol.js";

describe("toCanonicalForexSymbol", () => {
  it("strips broker M suffix to the canonical key", () => {
    assert.equal(toCanonicalForexSymbol("XAUUSDM"), "XAUUSD");
    assert.equal(toCanonicalForexSymbol("EURUSDm"), "EURUSD");
    assert.equal(toCanonicalForexSymbol("xauusd.pro"), "XAUUSD");
  });

  it("leaves canonical pairs unchanged", () => {
    assert.equal(toCanonicalForexSymbol("EURUSD"), "EURUSD");
    assert.equal(toCanonicalForexSymbol("XAUUSD"), "XAUUSD");
  });

  it("detects broker-only tickers", () => {
    assert.equal(isBrokerForexSuffix("XAUUSDM"), true);
    assert.equal(isBrokerForexSuffix("XAUUSD"), false);
  });
});
