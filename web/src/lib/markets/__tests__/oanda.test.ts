import assert from "node:assert/strict";
import { test } from "node:test";
import {
  toOandaInstrument,
  fromOandaInstrument,
  toOandaGranularity,
} from "../oanda";

test("maps AiChart symbols to OANDA instruments", () => {
  assert.equal(toOandaInstrument("EURUSD"), "EUR_USD");
  assert.equal(toOandaInstrument("XAUUSD"), "XAU_USD");
  assert.equal(toOandaInstrument("gbpjpy"), "GBP_JPY");
  assert.equal(toOandaInstrument("EUR_USD"), "EUR_USD");
});

test("rejects unmappable symbols", () => {
  assert.equal(toOandaInstrument("NOTFOREX"), null);
  assert.equal(toOandaInstrument("US30"), null);
});

test("round-trips OANDA instrument back to AiChart symbol", () => {
  assert.equal(fromOandaInstrument("EUR_USD"), "EURUSD");
  assert.equal(fromOandaInstrument("XAU_USD"), "XAUUSD");
});

test("maps intervals to native OANDA granularities", () => {
  assert.equal(toOandaGranularity("1h"), "H1");
  assert.equal(toOandaGranularity("4h"), "H4");
  assert.equal(toOandaGranularity("15m"), "M15");
  assert.equal(toOandaGranularity("1d"), "D");
  assert.equal(toOandaGranularity("1w"), "W");
});

test("returns null for non-native granularities (caller falls back)", () => {
  assert.equal(toOandaGranularity("10m"), null);
  assert.equal(toOandaGranularity("3h"), null);
});
