import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  brokerSymbolMatches,
  normalizeForCompare,
  pickBrokerSymbol,
  resolveBrokerSymbolFromCatalogue,
} from "../brokerSymbolResolve";

describe("normalizeForCompare", () => {
  it("strips non-alphanumerics and uppercases for comparison only", () => {
    assert.equal(normalizeForCompare("XAUUSD.pro"), "XAUUSDPRO");
    assert.equal(normalizeForCompare("xauusd_i"), "XAUUSDI");
  });
});

describe("brokerSymbolMatches", () => {
  it("matches Exness-style lowercase suffix against a canonical key", () => {
    assert.equal(brokerSymbolMatches("XAUUSD", "XAUUSDm"), true);
    assert.equal(brokerSymbolMatches("EURUSD", "EURUSDm"), true);
  });

  it("matches dotted and underscored broker spellings", () => {
    assert.equal(brokerSymbolMatches("XAUUSD", "XAUUSD.pro"), true);
    assert.equal(brokerSymbolMatches("XAUUSD", "XAUUSD_i"), true);
    assert.equal(brokerSymbolMatches("XAUUSD", "XAUUSDc"), true);
  });

  it("matches plain canonical to itself", () => {
    assert.equal(brokerSymbolMatches("XAUUSD", "XAUUSD"), true);
  });

  it("does not invent a match across different pairs", () => {
    assert.equal(brokerSymbolMatches("EURUSD", "XAUUSDm"), false);
  });
});

describe("pickBrokerSymbol / resolveBrokerSymbolFromCatalogue", () => {
  const catalogue = [
    { broker_symbol: "XAUUSDm", canonical: "XAUUSD" },
    { broker_symbol: "EURUSDm", canonical: "EURUSD" },
    { broker_symbol: "GBPUSD.pro", canonical: "GBPUSD" },
  ];

  it("returns the broker's exact spelling, case included", () => {
    assert.equal(pickBrokerSymbol("XAUUSD", catalogue), "XAUUSDm");
    assert.equal(pickBrokerSymbol("GBPUSD", catalogue), "GBPUSD.pro");
  });

  it("preserves an already-broker-spelled input when it is in the catalogue", () => {
    assert.equal(pickBrokerSymbol("XAUUSDm", catalogue), "XAUUSDm");
  });

  it("never uppercases a broker spelling on the way out", () => {
    const resolved = resolveBrokerSymbolFromCatalogue("XAUUSD", catalogue);
    assert.equal(resolved, "XAUUSDm");
    assert.notEqual(resolved, "XAUUSDM");
  });

  it("passes through a broker-spelled input when the catalogue has no hit", () => {
    assert.equal(
      resolveBrokerSymbolFromCatalogue("AAPLm", []),
      "AAPLm",
    );
  });

  it("resolves invented suffixes no one hard-coded (dynamic catalogue)", () => {
    const weird = [
      { broker_symbol: "XAUUSD.raw", canonical: "XAUUSD" },
      { broker_symbol: "XAUUSDµ", canonical: "XAUUSD" },
      { broker_symbol: "XAUUSD-ecn", canonical: "XAUUSD" },
    ];
    // First match wins — prove each spelling resolves when it is the only row.
    assert.equal(
      pickBrokerSymbol("XAUUSD", [weird[0]!]),
      "XAUUSD.raw",
    );
    assert.equal(
      pickBrokerSymbol("XAUUSD", [weird[1]!]),
      "XAUUSDµ",
    );
    assert.equal(
      pickBrokerSymbol("XAUUSD", [weird[2]!]),
      "XAUUSD-ecn",
    );
  });
});
