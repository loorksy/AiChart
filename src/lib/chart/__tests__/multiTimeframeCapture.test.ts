import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { QUICKCHART_CANDLE_LIMIT } from "@/lib/chartSnapshot";
import { canonicalizeInterval } from "@/lib/intervals";
import {
  DEFAULT_MAX_IMAGES,
  MAX_IMAGES_LIMIT,
  NUMERIC_CANDLE_LIMIT,
  resolveVisualTimeframes,
  VISUAL_EVIDENCE_GUARDRAILS,
} from "@/lib/chart/multiTimeframeCapture";
import {
  chartSnapshotCacheKey,
  chartSnapshotCacheSize,
  clearChartSnapshotCache,
  getCachedChartSnapshot,
  setCachedChartSnapshot,
} from "@/lib/chart/snapshotCache";

describe("canonicalizeInterval", () => {
  it("accepts the agent-facing uppercase labels", () => {
    assert.equal(canonicalizeInterval("1D"), "1d");
    assert.equal(canonicalizeInterval("1W"), "1w");
    assert.equal(canonicalizeInterval("4H"), "4h");
    assert.equal(canonicalizeInterval("15 min"), "15m");
  });

  it("keeps 1m and 1M distinct", () => {
    assert.equal(canonicalizeInterval("1m"), "1m");
    assert.equal(canonicalizeInterval("1M"), "1M");
    assert.equal(canonicalizeInterval("1month"), "1M");
  });

  it("returns null instead of silently falling back to 1h", () => {
    assert.equal(canonicalizeInterval("7h"), null);
    assert.equal(canonicalizeInterval("banana"), null);
    assert.equal(canonicalizeInterval(""), null);
  });
});

describe("resolveVisualTimeframes", () => {
  it("uses the balanced default set when none is requested", () => {
    const resolved = resolveVisualTimeframes(undefined);
    assert.deepEqual(resolved.timeframes, ["15m", "1h", "4h", "1d"]);
    assert.deepEqual(resolved.skipped, []);
    assert.equal(resolved.maxImages, DEFAULT_MAX_IMAGES);
  });

  it("canonicalises the documented scalp and swing sets", () => {
    assert.deepEqual(
      resolveVisualTimeframes(["5m", "15m", "1h"]).timeframes,
      ["5m", "15m", "1h"],
    );
    assert.deepEqual(
      resolveVisualTimeframes(["1h", "4h", "1D", "1W"]).timeframes,
      ["1h", "4h", "1d", "1w"],
    );
  });

  it("reports unsupported timeframes rather than duplicating 1h", () => {
    const resolved = resolveVisualTimeframes(["15m", "7h", "1D"]);
    assert.deepEqual(resolved.timeframes, ["15m", "1d"]);
    assert.deepEqual(resolved.skipped, [
      { timeframe: "7h", reason: "unsupported_timeframe" },
    ]);
  });

  it("de-duplicates labels that canonicalise to the same interval", () => {
    const resolved = resolveVisualTimeframes(["1D", "1d", "1 day"]);
    assert.deepEqual(resolved.timeframes, ["1d"]);
    assert.equal(resolved.skipped.length, 2);
    assert.ok(resolved.skipped.every((s) => s.reason === "duplicate_timeframe"));
  });

  it("trims to the image budget and says what it dropped", () => {
    const resolved = resolveVisualTimeframes(
      ["5m", "15m", "1h", "4h", "1d"],
      3,
    );
    assert.deepEqual(resolved.timeframes, ["5m", "15m", "1h"]);
    assert.deepEqual(
      resolved.skipped.map((s) => s.timeframe),
      ["4h", "1d"],
    );
    assert.ok(resolved.skipped.every((s) => s.reason === "max_images_exceeded"));
  });

  it("clamps an out-of-range budget instead of trusting the caller", () => {
    assert.equal(resolveVisualTimeframes(["1h"], 0).maxImages, 1);
    assert.equal(
      resolveVisualTimeframes(["1h"], 99).maxImages,
      MAX_IMAGES_LIMIT,
    );
  });
});

describe("visual evidence guardrails", () => {
  it("travels with every payload and states the two hard rules", () => {
    const text = VISUAL_EVIDENCE_GUARDRAILS.join(" ").toLowerCase();
    assert.ok(text.includes("detect_levels"), "levels must come from numbers");
    assert.ok(
      text.includes("never authorises live execution"),
      "images must not authorise execution",
    );
  });
});

describe("chart snapshot cache", () => {
  afterEach(() => {
    clearChartSnapshotCache();
    delete process.env.CHART_SNAPSHOT_CACHE_TTL_MS;
  });

  it("returns a stored snapshot within the TTL", () => {
    const key = chartSnapshotCacheKey(7, "xauusd", "1h", "forex");
    setCachedChartSnapshot(key, {
      imageBase64: "AAAA",
      source: "quickchart",
      capturedAt: 1_000,
    });
    const hit = getCachedChartSnapshot(key);
    assert.equal(hit?.imageBase64, "AAAA");
    assert.equal(hit?.source, "quickchart");
  });

  it("expires the entry once the TTL has passed", () => {
    process.env.CHART_SNAPSHOT_CACHE_TTL_MS = "1000";
    const key = chartSnapshotCacheKey(7, "XAUUSD", "1h", "forex");
    setCachedChartSnapshot(
      key,
      { imageBase64: "AAAA", source: "quickchart", capturedAt: 0 },
      10_000,
    );
    assert.ok(getCachedChartSnapshot(key, 10_500));
    assert.equal(getCachedChartSnapshot(key, 11_001), null);
  });

  it("never mixes users, symbols, timeframes, or markets", () => {
    const base = chartSnapshotCacheKey(1, "XAUUSD", "1h", "forex");
    assert.notEqual(base, chartSnapshotCacheKey(2, "XAUUSD", "1h", "forex"));
    assert.notEqual(base, chartSnapshotCacheKey(1, "EURUSD", "1h", "forex"));
    assert.notEqual(base, chartSnapshotCacheKey(1, "XAUUSD", "4h", "forex"));
    // Symbol casing must not create a second entry for the same chart.
    assert.equal(base, chartSnapshotCacheKey(1, "xauusd", "1h", "forex"));
  });

  it("stores nothing when the TTL is disabled", () => {
    process.env.CHART_SNAPSHOT_CACHE_TTL_MS = "0";
    const key = chartSnapshotCacheKey(3, "EURUSD", "15m", "forex");
    setCachedChartSnapshot(key, {
      imageBase64: "AAAA",
      source: "quickchart",
      capturedAt: 0,
    });
    assert.equal(chartSnapshotCacheSize(), 0);
    assert.equal(getCachedChartSnapshot(key), null);
  });
});

describe("agent chart evidence depth", () => {
  it("uses 200 QuickChart bars and 350 numeric bars", () => {
    assert.equal(QUICKCHART_CANDLE_LIMIT, 200);
    assert.equal(NUMERIC_CANDLE_LIMIT, 350);
  });
});
