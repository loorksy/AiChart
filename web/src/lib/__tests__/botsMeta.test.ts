import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEaBridgeSidecar } from "@/lib/botsMeta";
import { pickDefaultSymbol } from "@/lib/botsMetaTypes";
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
