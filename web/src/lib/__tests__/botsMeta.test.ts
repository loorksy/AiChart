import assert from "node:assert/strict";
import { test } from "node:test";
import { pickDefaultSymbol } from "@/lib/botsMetaTypes";

test("pickDefaultSymbol prefers XAUUSD for forex when available", () => {
  const sym = pickDefaultSymbol("forex", [
    { symbol: "EURUSD", market: "forex", spreadPips: 1, spreadPct: null, tradable: true, tickLabel: "1 pips" },
    { symbol: "XAUUSD", market: "forex", spreadPips: 2, spreadPct: null, tradable: true, tickLabel: "2 pips" },
  ]);
  assert.equal(sym, "XAUUSD");
});

test("pickDefaultSymbol prefers BTCUSDT for crypto", () => {
  const sym = pickDefaultSymbol("crypto", [
    { symbol: "ETHUSDT", market: "crypto", spreadPips: null, spreadPct: null, tradable: true, tickLabel: null },
    { symbol: "BTCUSDT", market: "crypto", spreadPips: null, spreadPct: null, tradable: true, tickLabel: null },
  ]);
  assert.equal(sym, "BTCUSDT");
});

test("pickDefaultSymbol skips non-tradable when tradable exist", () => {
  const sym = pickDefaultSymbol("forex", [
    { symbol: "ZZZUSD", market: "forex", spreadPips: null, spreadPct: null, tradable: false, tickLabel: null },
    { symbol: "EURUSD", market: "forex", spreadPips: 1, spreadPct: null, tradable: true, tickLabel: "1 pips" },
  ]);
  assert.equal(sym, "EURUSD");
});
