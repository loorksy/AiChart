import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeometryCandle } from "@/lib/chart/geometry";
import {
  detectChartGeometry,
  geometryToDrawings,
  summarizeGeometry,
  zigzagPivots,
  allConfirmedPivots,
  geometryAtr,
} from "@/lib/chart/geometry";

/**
 * Synthetic OHLC builders. Every fixture is deterministic: a base drift plus
 * engineered swings, with a fixed bar range so ATR is stable (~1.0).
 */
const START = 1_700_000_000_000;
const BAR_MS = 900_000; // 15m

function candle(index: number, low: number, high: number, close?: number): GeometryCandle {
  const mid = (low + high) / 2;
  return {
    time: START + index * BAR_MS,
    open: mid,
    high,
    low,
    close: close ?? mid,
  };
}

/** Flat noise bars around `level` with range ~1. */
function noiseBars(from: number, count: number, level: number): GeometryCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const wiggle = (i % 3) * 0.1;
    return candle(from + i, level - 0.5 + wiggle, level + 0.5 + wiggle);
  });
}

/**
 * Ascending triangle: flat resistance at 110, rising support from 100.
 * Ends with an upside breakout close above 110.
 */
function ascendingTriangleCandles(breakout: boolean): GeometryCandle[] {
  const out: GeometryCandle[] = noiseBars(0, 20, 100);
  let index = 20;
  const swings: Array<[number, number]> = [
    // [swing low, swing high] pairs stepping the support upward, top flat.
    [100, 110],
    [102, 110],
    [104, 110],
    [106, 110],
  ];
  for (const [low, high] of swings) {
    // Leg up to the flat top.
    for (let i = 0; i < 6; i++) {
      const p = low + ((high - low) * i) / 5;
      out.push(candle(index++, p - 0.5, p + 0.5));
    }
    // Leg down to the rising support.
    for (let i = 0; i < 6; i++) {
      const p = high - ((high - low + 2) * i) / 5;
      out.push(candle(index++, Math.max(p - 0.5, low - 0.5), p + 0.5));
    }
  }
  if (breakout) {
    for (let i = 0; i < 4; i++) {
      const p = 110 + i * 1.2;
      out.push(candle(index++, p - 0.4, p + 0.8, p + 0.6));
    }
  } else {
    out.push(...noiseBars(index, 3, 108));
  }
  return out;
}

/** Head & shoulders top around a 100 base: shoulders ~108, head ~113. */
function headShouldersCandles(complete: boolean): GeometryCandle[] {
  const out: GeometryCandle[] = noiseBars(0, 20, 100);
  let index = 20;
  const walk = (fromP: number, toP: number, bars: number) => {
    for (let i = 1; i <= bars; i++) {
      const p = fromP + ((toP - fromP) * i) / bars;
      out.push(candle(index++, p - 0.5, p + 0.5, p));
    }
  };
  walk(100, 108, 8); // left shoulder up
  walk(108, 101, 6); // trough 1
  walk(101, 113, 8); // head up
  walk(113, 101.5, 8); // trough 2
  walk(101.5, 108.2, 8); // right shoulder
  walk(108.2, 103, 6); // roll over toward the neckline (~101.2)
  if (complete) {
    walk(103, 97, 6); // close through the neckline → completed
    out.push(...noiseBars(index, 4, 96.5));
  } else {
    out.push(...noiseBars(index, 6, 103)); // hovering above the neckline
  }
  return out;
}

/** Bull flag: strong impulse 100→112, shallow drift down, breakout up. */
function bullFlagCandles(breakout: boolean): GeometryCandle[] {
  const out: GeometryCandle[] = noiseBars(0, 40, 100);
  let index = 40;
  // Impulse: 8 bars, +12 total (ATR ≈ 1 → 12 ATR ≫ 2.5 ATR minimum).
  for (let i = 1; i <= 8; i++) {
    const p = 100 + (12 * i) / 8;
    out.push(candle(index++, p - 0.6, p + 0.6, p + 0.4));
  }
  // Consolidation: 10 bars drifting down ~2 (retrace ~17% < 60%).
  for (let i = 0; i < 10; i++) {
    const p = 112 - (2 * i) / 9;
    out.push(candle(index++, p - 0.5, p + 0.5, p));
  }
  if (breakout) {
    for (let i = 0; i < 4; i++) {
      const p = 112.6 + i * 1.1;
      out.push(candle(index++, p - 0.4, p + 0.7, p + 0.5));
    }
  } else {
    // Collapse through the flag's lower boundary → invalidation.
    for (let i = 0; i < 5; i++) {
      const p = 109 - i * 1.4;
      out.push(candle(index++, p - 0.6, p + 0.4, p - 0.3));
    }
  }
  return out;
}

describe("pivots", () => {
  it("zigzag alternates strictly and respects the ATR filter", () => {
    const candles = ascendingTriangleCandles(false);
    const atr = geometryAtr(candles);
    assert.ok(atr > 0);
    const zigzag = zigzagPivots(candles, atr);
    assert.ok(zigzag.length >= 4);
    for (let i = 1; i < zigzag.length; i++) {
      assert.notEqual(zigzag[i]!.kind, zigzag[i - 1]!.kind, "must alternate");
    }
  });

  it("confirmed pivots produce output for both sides", () => {
    const candles = headShouldersCandles(false);
    const pivots = allConfirmedPivots(candles);
    assert.ok(pivots.some((p) => p.kind === "high"));
    assert.ok(pivots.some((p) => p.kind === "low"));
  });
});

describe("detectChartGeometry — determinism and bounds", () => {
  it("same input twice → identical output", () => {
    const candles = ascendingTriangleCandles(true);
    const a = detectChartGeometry({ candles });
    const b = detectChartGeometry({ candles });
    assert.deepEqual(a, b);
  });

  it("respects the output bounds", () => {
    const candles = headShouldersCandles(true);
    const snapshot = detectChartGeometry({ candles });
    assert.ok(snapshot.trendlines.length <= 4, "≤2 lines per side");
    assert.ok(snapshot.channels.length <= 1);
    assert.ok(snapshot.patterns.length <= 3);
  });

  it("returns an empty snapshot below the minimum window", () => {
    const snapshot = detectChartGeometry({ candles: noiseBars(0, 30, 100) });
    assert.equal(snapshot.patterns.length, 0);
    assert.equal(snapshot.trendlines.length, 0);
  });
});

describe("ascending triangle", () => {
  it("completes upward on the breakout close", () => {
    const snapshot = detectChartGeometry({ candles: ascendingTriangleCandles(true) });
    const triangle = snapshot.patterns.find((p) =>
      p.patternType.includes("triangle"),
    );
    assert.ok(triangle, "triangle detected");
    assert.equal(triangle!.status, "completed");
    assert.equal(triangle!.breakDirection, "up");
    assert.ok(
      triangle!.projectedTarget != null && triangle!.projectedTarget > 110,
      "measured-move target above the breakout level",
    );
  });

  it("stays forming while price holds inside the boundaries", () => {
    const snapshot = detectChartGeometry({ candles: ascendingTriangleCandles(false) });
    const triangle = snapshot.patterns.find((p) =>
      p.patternType.includes("triangle"),
    );
    assert.ok(triangle, "triangle detected");
    assert.equal(triangle!.status, "forming");
    // Forming evidence is discounted relative to completed.
    const completed = detectChartGeometry({
      candles: ascendingTriangleCandles(true),
    }).patterns.find((p) => p.patternType.includes("triangle"));
    if (completed) {
      assert.ok(triangle!.confidence <= completed.confidence);
    }
  });
});

describe("head & shoulders", () => {
  it("completes on the neckline break with a downward target", () => {
    const snapshot = detectChartGeometry({ candles: headShouldersCandles(true) });
    const hs = snapshot.patterns.find(
      (p) => p.patternType === "head_and_shoulders",
    );
    assert.ok(hs, "H&S detected");
    assert.equal(hs!.status, "completed");
    assert.equal(hs!.breakDirection, "down");
    assert.ok(hs!.neckline, "neckline present");
    assert.ok(
      hs!.projectedTarget != null && hs!.projectedTarget < 101,
      "target projected below the neckline",
    );
    assert.equal(hs!.anchors.length, 5);
  });

  it("reports forming while the neckline holds", () => {
    const snapshot = detectChartGeometry({ candles: headShouldersCandles(false) });
    const hs = snapshot.patterns.find(
      (p) => p.patternType === "head_and_shoulders",
    );
    assert.ok(hs, "H&S detected");
    assert.equal(hs!.status, "forming");
  });
});

describe("bull flag", () => {
  it("completes in the impulse direction on breakout", () => {
    const snapshot = detectChartGeometry({ candles: bullFlagCandles(true) });
    const flag = snapshot.patterns.find(
      (p) => p.patternType === "flag" || p.patternType === "pennant",
    );
    assert.ok(flag, "flag detected");
    assert.equal(flag!.status, "completed");
    assert.equal(flag!.breakDirection, "up");
  });

  it("a failed flag is invalidated, never completed", () => {
    const snapshot = detectChartGeometry({ candles: bullFlagCandles(false) });
    const flag = snapshot.patterns.find(
      (p) => p.patternType === "flag" || p.patternType === "pennant",
    );
    if (flag) {
      assert.equal(flag.status, "invalidated");
    }
    // Either way, no completed up-flag may be claimed on this fixture.
    assert.ok(
      !snapshot.patterns.some(
        (p) =>
          (p.patternType === "flag" || p.patternType === "pennant") &&
          p.status === "completed",
      ),
    );
  });
});

describe("drawings and summaries", () => {
  it("converts patterns to vocabulary-bound drawings with state labels", () => {
    const snapshot = detectChartGeometry({ candles: headShouldersCandles(true) });
    const drawings = geometryToDrawings(snapshot);
    const pattern = drawings.find((d) => d.type === "polyline_pattern");
    assert.ok(pattern, "polyline_pattern emitted");
    assert.equal(pattern!.patternType, "head_and_shoulders");
    assert.match(pattern!.label ?? "", /مكتمل/);
    // H&S gains synthetic lead-in/exit → 7 points for the native TV tool.
    assert.equal(pattern!.points.length, 7);
    assert.ok(drawings.some((d) => d.type === "neckline"), "neckline drawn");
  });

  it("summaries carry states, targets, and Arabic names — numbers not pixels", () => {
    const snapshot = detectChartGeometry({ candles: ascendingTriangleCandles(true) });
    const summary = summarizeGeometry(snapshot);
    const triangle = summary.patterns.find((p) => p.pattern.includes("triangle"));
    assert.ok(triangle);
    assert.equal(triangle!.status, "completed");
    assert.ok(triangle!.pattern_ar.length > 0);
    assert.ok(triangle!.projected_target != null);
  });
});
