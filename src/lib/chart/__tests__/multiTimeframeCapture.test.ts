import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { QUICKCHART_CANDLE_LIMIT } from "@/lib/chartSnapshot";
import { canonicalizeInterval } from "@/lib/intervals";
import { LIVE_CAPTURE_ACK_MS } from "@/lib/chart/liveCapture";
import {
  DEFAULT_MAX_IMAGES,
  MAX_IMAGES_LIMIT,
  NUMERIC_CANDLE_LIMIT,
  captureBudgets,
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
  it("travels with every payload and states the hard rules", () => {
    const text = VISUAL_EVIDENCE_GUARDRAILS.join(" ").toLowerCase();
    assert.ok(text.includes("detect_levels"), "levels must come from numbers");
    // TradingView-only, and blindness is stated: there is no fallback image
    // any more — a run with no live session must SAY it analysed numbers.
    assert.ok(
      text.includes("tradingview client capture"),
      "the only image source is TradingView's client capture",
    );
    assert.ok(
      text.includes("no image"),
      "a browserless run has no image and must say so",
    );
    assert.ok(
      text.includes("two-shot"),
      "each timeframe arrives as the context+zoom pair",
    );
    assert.ok(
      text.includes("drawings_included=false"),
      "missing drawings force visual_confirmation not_checked",
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
      source: "quickchart_fallback",
      capturedAt: 1_000,
    });
    const hit = getCachedChartSnapshot(key);
    assert.equal(hit?.imageBase64, "AAAA");
    assert.equal(hit?.source, "quickchart_fallback");
  });

  it("expires the entry once the TTL has passed", () => {
    process.env.CHART_SNAPSHOT_CACHE_TTL_MS = "1000";
    const key = chartSnapshotCacheKey(7, "XAUUSD", "1h", "forex");
    setCachedChartSnapshot(
      key,
      { imageBase64: "AAAA", source: "quickchart_fallback", capturedAt: 0 },
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
      source: "quickchart_fallback",
      capturedAt: 0,
    });
    assert.equal(chartSnapshotCacheSize(), 0);
    assert.equal(getCachedChartSnapshot(key), null);
  });
});

describe("agent chart evidence depth", () => {
  it("uses 350 QuickChart bars and 350 numeric bars", () => {
    assert.equal(QUICKCHART_CANDLE_LIMIT, 350);
    assert.equal(NUMERIC_CANDLE_LIMIT, 350);
  });
});

describe("captureBudgets", () => {
  // The bug this pins: a batch is dispatched concurrently but rendered
  // SERIALLY by one chart tab, so frame N waits out the N-1 frames ahead of
  // it. Sized as though it were alone, the tail of every batch died in the
  // queue — live, that read as "تعذّر التقاط 15m، 4h" on analysis after
  // analysis while a lone capture of the SAME frame returned in 4.2s.

  it("gives a lone capture exactly its own render budget", () => {
    const { timeoutMs, ackTimeoutMs } = captureBudgets(9_000, 1);
    assert.equal(timeoutMs, 9_000);
    assert.equal(ackTimeoutMs, LIVE_CAPTURE_ACK_MS);
  });

  it("scales BOTH deadlines with the queue behind the frame", () => {
    const one = captureBudgets(9_000, 1);
    const three = captureBudgets(9_000, 3);
    assert.equal(three.timeoutMs, 27_000);
    assert.equal(three.ackTimeoutMs, LIVE_CAPTURE_ACK_MS * 3);
    // The regression itself: the third frame of a batch must not be judged by
    // the budget of a frame that had the tab to itself.
    assert.ok(three.timeoutMs > one.timeoutMs);
    assert.ok(three.ackTimeoutMs > one.ackTimeoutMs);
  });

  it("covers the measured serial cost of a real 3-frame batch", () => {
    // Measured live 2026-08-24: one render ~4.2s, so three run ~12.6s and the
    // third is first acknowledged around 8.4s. Both must fit.
    const { timeoutMs, ackTimeoutMs } = captureBudgets(9_000, 3);
    assert.ok(timeoutMs >= 12_600, "batch deadline must outlast three renders");
    assert.ok(ackTimeoutMs >= 8_400, "third frame is acked only after two renders");
  });

  it("still fails in finite time when the tab is wedged", () => {
    // A ceiling, not an open door: a stuck tab must not hold the visual stage
    // for as long as an arbitrarily large batch would imply.
    const huge = captureBudgets(20_000, 12);
    assert.equal(huge.timeoutMs, 45_000);
    assert.equal(huge.ackTimeoutMs, 45_000);
  });

  it("treats a missing or nonsensical queue depth as a lone capture", () => {
    assert.equal(captureBudgets(9_000, undefined).timeoutMs, 9_000);
    assert.equal(captureBudgets(9_000, 0).timeoutMs, 9_000);
    assert.equal(captureBudgets(9_000, -4).timeoutMs, 9_000);
  });

  it("keeps the per-render floor and ceiling before multiplying", () => {
    // A caller asking for 1ms still gets the floor; one asking for a minute
    // still gets the single-render ceiling, and only THEN the queue applies.
    assert.equal(captureBudgets(1, 1).timeoutMs, 2_000);
    assert.equal(captureBudgets(60_000, 1).timeoutMs, 20_000);
  });
});
