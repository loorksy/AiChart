/**
 * Gold-only contract.
 *
 * Replaces the former 20-pair universe tests. Pins that the platform has
 * exactly one instrument, that every spelling of it resolves, and that the
 * server-side guard is loud while the UI guard is silent — the asymmetry is
 * deliberate (see lib/gold.ts) and easy to erode.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DATA_SYMBOL,
  OANDA_INSTRUMENT,
  PIP_SIZE,
  TIMEFRAMES,
  GoldOnlyError,
  coerceToGold,
  isGold,
  isTimeframe,
  requireGold,
} from "@/lib/gold";
import { FOREX_INSTRUMENTS, TRADABLE_SYMBOLS, forexBaseQuote, isKnownForexSymbol } from "@/lib/markets/forexInstruments";
import { toOandaInstrument } from "@/lib/markets/oanda";
import { pipSizeForSymbol } from "@/lib/spread";
import { biasParamsForSymbol } from "@/lib/agent/symbolProfiles";

describe("gold is the only instrument", () => {
  it("exposes exactly one tradable symbol", () => {
    assert.deepEqual([...TRADABLE_SYMBOLS], [DATA_SYMBOL]);
    assert.equal(FOREX_INSTRUMENTS.length, 1);
    assert.equal(FOREX_INSTRUMENTS[0]!.symbol, DATA_SYMBOL);
  });

  it("recognises every spelling of gold, and nothing else", () => {
    for (const spelling of ["XAUUSD", "xauusd", "XAUUSDm", "XAU/USD", "XAU_USD", "XAUUSD.pro"]) {
      assert.equal(isGold(spelling), true, spelling);
    }
    for (const other of ["EURUSD", "BTCUSD", "XAGUSD", "US30", "", "GOLD"]) {
      assert.equal(isGold(other), false, other);
    }
    assert.equal(isGold(null), false);
    assert.equal(isGold(undefined), false);
  });

  it("keeps the OANDA spelling at the single boundary that needs it", () => {
    assert.equal(toOandaInstrument(DATA_SYMBOL), OANDA_INSTRUMENT);
    assert.equal(toOandaInstrument("XAUUSDm"), OANDA_INSTRUMENT);
    // A non-gold instrument has no OANDA identity here.
    assert.equal(toOandaInstrument("EURUSD"), null);
    assert.equal(toOandaInstrument("BTCUSD"), null);
  });
});

describe("the two guards behave differently on purpose", () => {
  it("requireGold throws on a non-gold symbol (server-side: loud)", () => {
    assert.equal(requireGold("XAUUSDm"), DATA_SYMBOL);
    assert.throws(() => requireGold("EURUSD"), GoldOnlyError);
    assert.throws(() => requireGold(""), GoldOnlyError);
    assert.throws(() => requireGold(null), GoldOnlyError);
  });

  it("coerceToGold never throws (UI-side: silent)", () => {
    assert.equal(coerceToGold("EURUSD"), DATA_SYMBOL);
    assert.equal(coerceToGold(undefined), DATA_SYMBOL);
    assert.equal(coerceToGold(null), DATA_SYMBOL);
  });
});

describe("gold's geometry agrees with the rest of the platform", () => {
  it("PIP_SIZE matches pipSizeForSymbol, which matches the research-service registry", () => {
    assert.equal(PIP_SIZE, 0.01);
    assert.equal(pipSizeForSymbol(DATA_SYMBOL), PIP_SIZE);
    // The pip must not drift with price — a past bug flipped it at $1000.
    assert.equal(pipSizeForSymbol(DATA_SYMBOL, 900), PIP_SIZE);
    assert.equal(pipSizeForSymbol(DATA_SYMBOL, 4300), PIP_SIZE);
  });

  it("splits into XAU/USD for display", () => {
    assert.deepEqual(forexBaseQuote(DATA_SYMBOL), { base: "XAU", quote: "USD" });
    assert.equal(isKnownForexSymbol("XAUUSDm"), true);
    assert.equal(isKnownForexSymbol("EURUSD"), false);
  });

  it("analyses exactly the four supported timeframes", () => {
    assert.deepEqual([...TIMEFRAMES], ["5m", "15m", "1h", "4h"]);
    assert.equal(isTimeframe("15m"), true);
    assert.equal(isTimeframe("1d"), false);
    assert.equal(isTimeframe("1m"), false);
  });

  it("uses gold's own bias threshold, not the forex-major default", () => {
    const params = biasParamsForSymbol();
    assert.equal(params.lookbackBars, 50);
    // Wider than the 0.003 a forex major used: gold noise would flip it.
    assert.ok(params.changeThreshold > 0.003, "gold needs a wider direction threshold");
  });
});
