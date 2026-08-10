import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TRADABLE_SYMBOLS } from "@/lib/markets/forexInstruments";
import {
  getSymbolProfile,
  biasParamsForSymbol,
  strategyFamiliesForSymbol,
  catalogEntriesForSymbolAndTimeframe,
  profiledSymbols,
} from "../symbolProfiles";

describe("symbolProfiles — one shared engine, parameterized per symbol", () => {
  it("has a profile for every symbol in the fixed 20-instrument universe, and no others", () => {
    const profiled = [...profiledSymbols()].sort();
    const tradable = [...TRADABLE_SYMBOLS].sort();
    assert.deepEqual(
      profiled,
      tradable,
      "symbolProfiles must exactly match the fixed universe — no gaps, no extras",
    );
  });

  it("resolves a broker-suffixed spelling to the same profile as the canonical symbol", () => {
    const canonical = getSymbolProfile("XAUUSD");
    const suffixed = getSymbolProfile("XAUUSDm");
    assert.ok(canonical);
    assert.deepEqual(suffixed, canonical);
  });

  it("returns null for a symbol outside the fixed universe", () => {
    assert.equal(getSymbolProfile("XAGUSD"), null);
    assert.equal(getSymbolProfile("US30"), null);
  });

  it("gives volatile instrument classes a wider bias threshold than forex majors", () => {
    const major = biasParamsForSymbol("EURUSD");
    const metal = biasParamsForSymbol("XAUUSD");
    const crypto = biasParamsForSymbol("BTCUSD");
    assert.ok(metal.changeThreshold > major.changeThreshold);
    assert.ok(crypto.changeThreshold > metal.changeThreshold);
  });

  it("falls back to forex-major bias params for an unprofiled symbol", () => {
    const fallback = biasParamsForSymbol("US30");
    const major = biasParamsForSymbol("EURUSD");
    assert.deepEqual(fallback, major);
  });

  it("excludes forex-session-structure strategies for the 24/7 crypto symbol", () => {
    const cryptoFamilies = strategyFamiliesForSymbol("BTCUSD");
    const fxFamilies = strategyFamiliesForSymbol("EURUSD");
    assert.ok(!cryptoFamilies.includes("session_range"));
    assert.ok(fxFamilies.includes("session_range"));
  });

  it("catalogEntriesForSymbolAndTimeframe never returns a family outside the symbol's profile", () => {
    const entries = catalogEntriesForSymbolAndTimeframe("BTCUSD", "1h");
    for (const entry of entries) {
      assert.notEqual(entry.family, "session_range");
    }
    assert.ok(entries.length > 0, "a real symbol must still get real strategy candidates");
  });
});
