import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
});

test("resolveForexBackendFromPref honors a valid user choice", async () => {
  process.env.MT5_BRIDGE_URL = "http://mt5.local";
  delete process.env.FOREX_BACKEND;
  const { resolveForexBackendFromPref } = await import("../brokers/forexBackend");
  assert.equal(resolveForexBackendFromPref("ea"), "ea");
  assert.equal(resolveForexBackendFromPref("mt5local"), "mt5local");
});

test("mt5local choice falls back when the bridge isn't configured", async () => {
  delete process.env.MT5_BRIDGE_URL;
  delete process.env.FOREX_BACKEND;
  delete process.env.METAAPI_TOKEN;
  const { resolveForexBackendFromPref } = await import("../brokers/forexBackend");
  // No MT5_BRIDGE_URL → can't honor mt5local → global default (EA).
  assert.equal(resolveForexBackendFromPref("mt5local"), "ea");
});

test("no preference uses the operator's global default", async () => {
  process.env.FOREX_BACKEND = "mt5local";
  process.env.MT5_BRIDGE_URL = "http://mt5.local";
  const { resolveForexBackendFromPref } = await import("../brokers/forexBackend");
  assert.equal(resolveForexBackendFromPref(null), "mt5local");
  assert.equal(resolveForexBackendFromPref(undefined), "mt5local");
});

test("EA is always selectable even without any server infra", async () => {
  delete process.env.MT5_BRIDGE_URL;
  process.env.FOREX_BACKEND = "mt5local"; // global wants mt5local…
  delete process.env.METAAPI_TOKEN;
  const { resolveForexBackendFromPref } = await import("../brokers/forexBackend");
  // …but the user explicitly chose EA, which needs no infra.
  assert.equal(resolveForexBackendFromPref("ea"), "ea");
});

test("forexModeToBrokerKind maps modes to broker kinds", async () => {
  const { forexModeToBrokerKind } = await import("../brokers/forexBackend");
  assert.equal(forexModeToBrokerKind("ea"), "mt_ea");
  assert.equal(forexModeToBrokerKind("mt5local"), "mt5_local");
  assert.equal(forexModeToBrokerKind("metaapi"), "metaapi");
});
