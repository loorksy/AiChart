import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearPlatformConfigCache } from "../platformConfig";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
  // getPlatformValue caches per-key once read; a value cached by an earlier
  // test (e.g. METAAPI_TOKEN) would otherwise survive the env reset above.
  clearPlatformConfigCache();
});

test("resolveForexBackendFromPref honors a valid user choice", async () => {
  process.env.MT5_BRIDGE_URL = "http://mt5.local";
  delete process.env.FOREX_BACKEND;
  const { resolveForexBackendFromPref } = await import("../brokers/forexBackend");
  assert.equal(resolveForexBackendFromPref("mt5local"), "mt5local");
});

test("mt5local choice falls back to the global default when the bridge isn't configured", async () => {
  delete process.env.MT5_BRIDGE_URL;
  process.env.FOREX_BACKEND = "metaapi";
  process.env.METAAPI_TOKEN = "tok";
  const { resolveForexBackendFromPref } = await import("../brokers/forexBackend");
  // No MT5_BRIDGE_URL → can't honor mt5local → global default.
  assert.equal(resolveForexBackendFromPref("mt5local"), "metaapi");
});

test("no preference uses the operator's global default", async () => {
  process.env.FOREX_BACKEND = "mt5local";
  process.env.MT5_BRIDGE_URL = "http://mt5.local";
  const { resolveForexBackendFromPref } = await import("../brokers/forexBackend");
  assert.equal(resolveForexBackendFromPref(null), "mt5local");
  assert.equal(resolveForexBackendFromPref(undefined), "mt5local");
});

test("getForexBackend falls back to metaapi when mt5local forced but bridge unset and token set", async () => {
  process.env.FOREX_BACKEND = "mt5local";
  delete process.env.MT5_BRIDGE_URL;
  process.env.METAAPI_TOKEN = "tok";
  const { getForexBackend } = await import("../brokers/forexBackend");
  assert.equal(getForexBackend(), "metaapi");
});

test("getForexBackend throws when nothing is configured — no silent EA fallback", async () => {
  delete process.env.FOREX_BACKEND;
  delete process.env.MT5_BRIDGE_URL;
  delete process.env.METAAPI_TOKEN;
  const { getForexBackend } = await import("../brokers/forexBackend");
  assert.throws(() => getForexBackend());
});

test("getForexBackend throws when mt5local is forced but nothing else is configured either", async () => {
  process.env.FOREX_BACKEND = "mt5local";
  delete process.env.MT5_BRIDGE_URL;
  delete process.env.METAAPI_TOKEN;
  const { getForexBackend } = await import("../brokers/forexBackend");
  assert.throws(() => getForexBackend());
});

test("FOREX_BACKEND=ea is a hard misconfiguration, not a silent fallback", async () => {
  process.env.FOREX_BACKEND = "ea";
  process.env.MT5_BRIDGE_URL = "http://mt5.local";
  const { getForexBackend } = await import("../brokers/forexBackend");
  assert.throws(() => getForexBackend(), /FOREX_BACKEND=ea is no longer supported/);
});

test("a stored 'ea' preference is treated as unrecognised, not honored", async () => {
  process.env.FOREX_BACKEND = "metaapi";
  process.env.METAAPI_TOKEN = "tok";
  delete process.env.MT5_BRIDGE_URL;
  const { resolveForexBackendFromPref } = await import("../brokers/forexBackend");
  assert.equal(resolveForexBackendFromPref("ea"), "metaapi");
});

test("forexModeToBrokerKind maps modes to broker kinds", async () => {
  const { forexModeToBrokerKind } = await import("../brokers/forexBackend");
  assert.equal(forexModeToBrokerKind("mt5local"), "mt5_local");
  assert.equal(forexModeToBrokerKind("metaapi"), "metaapi");
});
