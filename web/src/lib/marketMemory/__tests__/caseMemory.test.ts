import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fingerprintAt,
  fingerprintSimilarity,
  fingerprintVector,
  type FingerprintCandle,
} from "@/lib/marketMemory/caseFingerprint";
import {
  MIN_STATS_SAMPLE,
  resolveForwardOutcome,
  summarizeOutcomes,
  type ForwardOutcome,
} from "@/lib/marketMemory/forwardOutcome";
import { describeSimilarCases } from "@/lib/marketMemory/caseQuery";

const HOUR = 3_600_000;

function series(
  count: number,
  shape: (index: number) => { close: number; spread?: number },
  startTime = Date.parse("2026-01-05T08:00:00Z"),
): FingerprintCandle[] {
  const candles: FingerprintCandle[] = [];
  let previous = shape(0).close;
  for (let i = 0; i < count; i++) {
    const { close, spread = 0.4 } = shape(i);
    candles.push({
      time: startTime + i * HOUR,
      open: previous,
      high: Math.max(previous, close) + spread,
      low: Math.min(previous, close) - spread,
      close,
    });
    previous = close;
  }
  return candles;
}

const uptrend = (i: number) => ({ close: 100 + i * 0.8 });
const flat = (i: number) => ({ close: 100 + Math.sin(i / 3) * 0.5 });

describe("case fingerprints", () => {
  it("reads a rising market as an uptrend", () => {
    const fingerprint = fingerprintAt(series(60, uptrend));
    assert.ok(fingerprint);
    assert.equal(fingerprint.trend, "up");
    assert.equal(fingerprint.rangeZone, "near_high");
  });

  it("reads a directionless market as flat", () => {
    const fingerprint = fingerprintAt(series(60, flat));
    assert.ok(fingerprint);
    assert.equal(fingerprint.trend, "flat");
    assert.equal(fingerprint.regime, "range");
  });

  it("refuses to describe a moment it cannot see enough of", () => {
    assert.equal(fingerprintAt(series(12, uptrend)), null);
  });

  /**
   * The load-bearing test for the whole memory. If appending later candles can
   * change a fingerprint, then every historical statistic derived from it was
   * computed with knowledge of the future.
   */
  it("does not change when candles after the moment are appended", () => {
    const history = series(60, uptrend);
    const before = fingerprintAt(history);

    // Whatever comes next — a crash, a melt-up — must not touch the moment.
    const crash = series(
      40,
      (i) => ({ close: 147 - i * 3 }),
      history.at(-1)!.time + HOUR,
    );
    const meltUp = series(
      40,
      (i) => ({ close: 147 + i * 3 }),
      history.at(-1)!.time + HOUR,
    );

    assert.deepEqual(fingerprintAt([...history, ...crash].slice(0, history.length)), before);
    assert.deepEqual(fingerprintAt([...history, ...meltUp].slice(0, history.length)), before);
    // And the reverse: the fingerprint of the extended series is a DIFFERENT
    // moment, not a corrected version of the same one.
    assert.notDeepEqual(fingerprintAt([...history, ...crash]), before);
  });

  it("scores identical moments as identical and opposite ones as far apart", () => {
    const up = fingerprintAt(series(60, uptrend))!;
    const down = fingerprintAt(series(60, (i) => ({ close: 150 - i * 0.8 })))!;
    assert.equal(fingerprintSimilarity(up, up), 1);
    assert.ok(
      fingerprintSimilarity(up, down) < 0.6,
      `an uptrend and a downtrend should not look alike, got ${fingerprintSimilarity(up, down)}`,
    );
  });

  it("keeps every feature inside the vector's declared range", () => {
    // A steep, wide-ranged decline — the shape most likely to push a normalized
    // feature past its bound.
    for (const shape of [uptrend, flat, (i: number) => ({ close: 400 - i * 4, spread: 6 })]) {
      const fingerprint = fingerprintAt(series(60, shape));
      assert.ok(fingerprint);
      for (const value of fingerprintVector(fingerprint)) {
        assert.ok(value >= -1 && value <= 1, `feature out of range: ${value}`);
      }
    }
  });
});

describe("forward outcomes", () => {
  const atr = 1;
  const entry = 100;

  it("records the target when price reaches it first", () => {
    const future = series(10, (i) => ({ close: 100 + i * 0.5, spread: 0.05 }), 0);
    const outcome = resolveForwardOutcome({ direction: "buy", entry, atr, future });
    assert.equal(outcome.resolution, "target_first");
    assert.ok(outcome.netR > 1.5);
  });

  it("records the stop when price reaches it first", () => {
    const future = series(10, (i) => ({ close: 100 - i * 0.5, spread: 0.05 }), 0);
    const outcome = resolveForwardOutcome({ direction: "buy", entry, atr, future });
    assert.equal(outcome.resolution, "stop_first");
    assert.equal(outcome.netR, -1);
  });

  it("resolves a bar that touches both levels against the trade", () => {
    // One bar spanning stop and target: from OHLC the order is unknowable.
    const future: FingerprintCandle[] = [
      { time: 0, open: 100, high: 103, low: 98, close: 102 },
    ];
    assert.equal(
      resolveForwardOutcome({ direction: "buy", entry, atr, future }).resolution,
      "stop_first",
    );
    assert.equal(
      resolveForwardOutcome({ direction: "sell", entry, atr, future }).resolution,
      "stop_first",
    );
  });

  it("leaves a case unresolved when neither level is reached", () => {
    const future = series(10, () => ({ close: 100.1, spread: 0.05 }), 0);
    const outcome = resolveForwardOutcome({ direction: "buy", entry, atr, future });
    assert.equal(outcome.resolution, "unresolved");
    assert.equal(outcome.netR, 0);
  });

  it("charges the cost of the round trip to the reward", () => {
    const future = series(10, (i) => ({ close: 100 + i * 0.5, spread: 0.05 }), 0);
    const free = resolveForwardOutcome({ direction: "buy", entry, atr, future });
    const costly = resolveForwardOutcome({ direction: "buy", entry, atr, future, cost: 0.3 });
    assert.ok(
      costly.netR < free.netR,
      `cost must reduce net R: ${costly.netR} vs ${free.netR}`,
    );
  });

  it("mirrors the geometry for a short", () => {
    const future = series(10, (i) => ({ close: 100 - i * 0.5, spread: 0.05 }), 0);
    assert.equal(
      resolveForwardOutcome({ direction: "sell", entry, atr, future }).resolution,
      "target_first",
    );
  });
});

describe("outcome statistics", () => {
  const win = (): ForwardOutcome => ({
    resolution: "target_first",
    bars: 8,
    maxFavourableAtr: 2,
    maxAdverseAtr: 0.3,
    netR: 2,
  });
  const loss = (): ForwardOutcome => ({
    resolution: "stop_first",
    bars: 4,
    maxFavourableAtr: 0.4,
    maxAdverseAtr: 1,
    netR: -1,
  });

  it("reports counts but no rate below a usable sample", () => {
    const stats = summarizeOutcomes([win(), win(), win(), loss()]);
    assert.equal(stats.sampleSize, 4);
    assert.equal(stats.targetFirst, 3);
    assert.equal(stats.hitRate, null, "3-of-4 is not a 75% edge");
    assert.equal(stats.averageNetR, null);
  });

  it("reports the rate once the sample supports it", () => {
    const outcomes = [
      ...Array.from({ length: 6 }, win),
      ...Array.from({ length: 4 }, loss),
    ];
    assert.ok(outcomes.length >= MIN_STATS_SAMPLE);
    const stats = summarizeOutcomes(outcomes);
    assert.equal(stats.hitRate, 0.6);
    assert.equal(stats.averageNetR, 0.8);
  });

  it("computes the hit rate over resolved cases only", () => {
    const stalled: ForwardOutcome = {
      resolution: "unresolved",
      bars: 40,
      maxFavourableAtr: 0.9,
      maxAdverseAtr: 0.8,
      netR: 0,
    };
    const stats = summarizeOutcomes([
      ...Array.from({ length: 6 }, win),
      ...Array.from({ length: 2 }, loss),
      stalled,
      stalled,
    ]);
    // 6 of 8 resolved — the two that never resolved are not silent losses.
    assert.equal(stats.hitRate, 0.75);
    assert.equal(stats.unresolved, 2);
  });
});

describe("describing the memory to the operator", () => {
  const stats = (over: Partial<ReturnType<typeof summarizeOutcomes>> = {}) => ({
    sampleSize: 12,
    targetFirst: 8,
    stopFirst: 4,
    unresolved: 0,
    hitRate: 0.667,
    averageNetR: 1.1,
    averageBars: 9,
    ...over,
  });

  it("says nothing at all when there is no comparable history", () => {
    assert.equal(
      describeSimilarCases({
        cases: [],
        stats: stats({ sampleSize: 0, targetFirst: 0, stopFirst: 0, hitRate: null }),
        candidatesConsidered: 900,
        statisticallyUsable: false,
        samePattern: null,
      }),
      null,
    );
  });

  it("distinguishes a small sample from an edge", () => {
    const text = describeSimilarCases({
      cases: [{} as never, {} as never],
      stats: stats({ sampleSize: 2, targetFirst: 2, stopFirst: 0, hitRate: null, averageNetR: null }),
      candidatesConsidered: 900,
      statisticallyUsable: false,
      samePattern: null,
    });
    assert.ok(text?.includes("عينة أصغر"), text ?? "expected a small-sample caveat");
    assert.ok(!text?.includes("100%"), "a 2-case sample must not be quoted as a percentage");
  });

  it("quotes the rate when the sample carries it", () => {
    const text = describeSimilarCases({
      cases: Array.from({ length: 12 }, () => ({}) as never),
      stats: stats(),
      candidatesConsidered: 900,
      statisticallyUsable: true,
      samePattern: null,
    });
    assert.ok(text?.includes("67%"), text ?? "expected the hit rate");
  });
});
