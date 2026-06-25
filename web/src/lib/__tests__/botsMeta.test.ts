import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEaBridgeSidecar,
  forexRowFromSpec,
  forexSymbolsFromEaSpecs,
  mergeBotSymbolRow,
} from "@/lib/botsMeta";
import { pickDefaultSymbol } from "@/lib/botsMetaTypes";
import type { BotBrokerSymbol } from "@/lib/botsMetaTypes";
import type { EaConnectionMeta } from "@/lib/types";

function eaMeta(overrides: Partial<EaConnectionMeta> = {}): EaConnectionMeta {
  return {
    id: 1,
    platform: "mt5",
    label: null,
    broker_name: "IC Markets",
    account_login: "12345",
    account_currency: "USD",
    balance: 1000,
    equity: 1000,
    status: "online",
    online: true,
    last_heartbeat_at: new Date().toISOString(),
    account_trade_mode: "demo",
    missedHeartbeats: 0,
    settledOnlineSeconds: 60,
    ...overrides,
  };
}

test("buildEaBridgeSidecar returns sidecar when EA online but execution is mt5local", () => {
  const { eaBridge, channelNote } = buildEaBridgeSidecar("mt5local", eaMeta());
  assert.ok(eaBridge);
  assert.equal(eaBridge?.online, true);
  assert.equal(eaBridge?.broker, "IC Markets");
  assert.match(channelNote ?? "", /MT5 محلي/);
  assert.match(channelNote ?? "", /EA/);
});

test("buildEaBridgeSidecar omits sidecar when execution backend is ea", () => {
  const { eaBridge, channelNote } = buildEaBridgeSidecar("ea", eaMeta());
  assert.equal(eaBridge, null);
  assert.equal(channelNote, null);
});

test("buildEaBridgeSidecar omits note when EA registered but offline", () => {
  const { eaBridge, channelNote } = buildEaBridgeSidecar(
    "metaapi",
    eaMeta({ online: false, status: "offline" }),
  );
  assert.ok(eaBridge);
  assert.equal(eaBridge?.online, false);
  assert.equal(channelNote, null);
});

test("buildEaBridgeSidecar omits sidecar when EA revoked", () => {
  const { eaBridge } = buildEaBridgeSidecar(
    "mt5local",
    eaMeta({ status: "revoked", online: false }),
  );
  assert.equal(eaBridge, null);
});

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

test("forexRowFromSpec extracts price and spread from EA heartbeat spec", () => {
  const row = forexRowFromSpec({
    symbol: "EURUSDm",
    bid: 1.085,
    ask: 1.0852,
    digits: 5,
  });
  assert.ok(row);
  assert.equal(row?.symbol, "EURUSDm");
  assert.equal(row?.tradable, true);
  assert.ok(row?.price != null && row.price > 1.085);
  assert.ok(row?.spreadPips != null);
  assert.ok(row?.tickLabel?.includes("pips"));
});

test("mergeBotSymbolRow prefers row with live quote over name-only row", () => {
  const map = new Map<string, BotBrokerSymbol>();
  mergeBotSymbolRow(map, {
    symbol: "EURUSD",
    market: "forex",
    spreadPips: null,
    spreadPct: null,
    tradable: true,
    tickLabel: null,
  });
  mergeBotSymbolRow(map, {
    symbol: "EURUSD",
    market: "forex",
    spreadPips: 1.2,
    spreadPct: null,
    tradable: true,
    tickLabel: "1.2 pips",
    price: 1.0851,
  });
  assert.equal(map.size, 1);
  const merged = map.get("EURUSD");
  assert.equal(merged?.price, 1.0851);
  assert.equal(merged?.tickLabel, "1.2 pips");
});

test("forexSymbolsFromEaSpecs returns only Market Watch forex rows", () => {
  const rows = forexSymbolsFromEaSpecs([
    { symbol: "EURUSDm", bid: 1.085, ask: 1.0852, digits: 5 },
    { symbol: "BTCUSD", bid: 65000, ask: 65010, digits: 2 },
    { symbol: "", bid: 0, ask: 0, digits: 0 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.symbol, "EURUSDm");
  assert.equal(rows[0]?.market, "forex");
});

test("forexSymbolsFromEaSpecs returns empty when no valid forex specs", () => {
  assert.deepEqual(forexSymbolsFromEaSpecs([]), []);
  assert.deepEqual(
    forexSymbolsFromEaSpecs([{ symbol: "BTCUSD", bid: 1, ask: 2, digits: 2 }]),
    [],
  );
});
