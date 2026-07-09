import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCanonicalInterval,
  ohlcCacheTtlMs,
  getHigherInterval,
  isCanonicalInterval,
} from "@/lib/markets/intervals";

describe("markets/intervals", () => {
  it("passes through canonical intervals", () => {
    assert.equal(normalizeCanonicalInterval("15m"), "15m");
    assert.equal(normalizeCanonicalInterval("1h"), "1h");
    assert.equal(normalizeCanonicalInterval("1d"), "1d");
  });

  it("maps TradingView resolutions to canonical", () => {
    assert.equal(normalizeCanonicalInterval("60"), "1h");
    assert.equal(normalizeCanonicalInterval("240"), "4h");
    assert.equal(normalizeCanonicalInterval("1D"), "1d");
  });

  it("resolves derived intervals to their native base", () => {
    // 3m resamples from 1m; 45m from 15m; 2d from 1d.
    assert.equal(normalizeCanonicalInterval("3m"), "1m");
    assert.equal(normalizeCanonicalInterval("45m"), "15m");
    assert.equal(normalizeCanonicalInterval("2d"), "1d");
  });

  it("falls back to 15m for unknown input", () => {
    assert.equal(normalizeCanonicalInterval("garbage"), "15m");
    assert.equal(normalizeCanonicalInterval(""), "15m");
    assert.equal(normalizeCanonicalInterval(null), "15m");
  });

  it("TTL scales with interval (shorter for fast timeframes)", () => {
    assert.ok(ohlcCacheTtlMs("1m") < ohlcCacheTtlMs("15m"));
    assert.ok(ohlcCacheTtlMs("15m") < ohlcCacheTtlMs("1h"));
    assert.ok(ohlcCacheTtlMs("1h") < ohlcCacheTtlMs("1d"));
  });

  it("higher interval is strictly coarser", () => {
    assert.equal(getHigherInterval("15m"), "1h");
    assert.equal(getHigherInterval("1h"), "4h");
    assert.equal(getHigherInterval("4h"), "1d");
  });

  it("isCanonicalInterval only accepts native OANDA intervals", () => {
    assert.ok(isCanonicalInterval("4h"));
    assert.ok(!isCanonicalInterval("3m"));
    assert.ok(!isCanonicalInterval("240"));
  });
});
