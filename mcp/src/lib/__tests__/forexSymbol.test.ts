import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBrokerForexSuffix,
  toOandaForexSymbol,
} from "../forexSymbol.js";

describe("toOandaForexSymbol", () => {
  it("strips broker M suffix for OANDA candles", () => {
    assert.equal(toOandaForexSymbol("XAUUSDM"), "XAUUSD");
    assert.equal(toOandaForexSymbol("EURUSDm"), "EURUSD");
    assert.equal(toOandaForexSymbol("xauusd.pro"), "XAUUSD");
  });

  it("leaves canonical pairs unchanged", () => {
    assert.equal(toOandaForexSymbol("EURUSD"), "EURUSD");
    assert.equal(toOandaForexSymbol("XAUUSD"), "XAUUSD");
  });

  it("detects broker-only tickers", () => {
    assert.equal(isBrokerForexSuffix("XAUUSDM"), true);
    assert.equal(isBrokerForexSuffix("XAUUSD"), false);
  });
});
