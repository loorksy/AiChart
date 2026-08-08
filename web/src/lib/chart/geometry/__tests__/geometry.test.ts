import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeometryCandle, GeometryPivot } from "@/lib/chart/geometry";
import {
  detectChartGeometry,
  detectTrendlines,
  geometryToDrawings,
  summarizeGeometry,
  zigzagPivots,
  allConfirmedPivots,
  confirmedPivots,
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
    // Leg down to the rising support. The low clamps at the support floor —
    // clamp the high with it so clamped candles stay well-formed (high > low
    // and a close on the right side of the boundary, not a phantom break).
    for (let i = 0; i < 6; i++) {
      const p = high - ((high - low + 2) * i) / 5;
      const lo = Math.max(p - 0.5, low - 0.5);
      out.push(candle(index++, lo, Math.max(p + 0.5, lo + 1)));
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

/** Hand-built pivot helper for direct trendline-engine tests. */
function lowPivot(index: number, price: number): GeometryPivot {
  return { index, time: START + index * BAR_MS, price, kind: "low" };
}

describe("trendline envelope engine", () => {
  /** Candle whose close is explicit; low/high wide enough to be neutral. */
  function bar(index: number, close: number, low?: number): GeometryCandle {
    return candle(index, low ?? close - 0.5, close + 0.5, close);
  }

  it("rejects a support pair when an interior candle CLOSES through the line", () => {
    // Line 100→102 across bars 10..50; the dip at 30 closes at 100.0 while the
    // line sits at 101.0 — a close-based violation between the anchors.
    const candles = Array.from({ length: 70 }, (_, i) => {
      if (i === 10) return bar(i, 106, 100);
      if (i === 50) return bar(i, 106, 102);
      if (i === 30) return candle(i, 99.8, 106.5, 100.0);
      return bar(i, 106, 105.5);
    });
    const pivots = [lowPivot(10, 100), lowPivot(50, 102)];
    const lines = detectTrendlines({ candles, pivots, atr: 1 });
    assert.equal(lines.filter((l) => l.side === "support").length, 0);
  });

  it("tolerates an interior WICK below the line (close-based rule)", () => {
    // Same shape but the dip closes back above the line: the wick to 99.8 is
    // a stop-run, not a break — the line remains a valid lower envelope.
    const candles = Array.from({ length: 70 }, (_, i) => {
      if (i === 10) return bar(i, 106, 100);
      if (i === 50) return bar(i, 106, 102);
      if (i === 30) return candle(i, 99.8, 106.5, 101.2);
      return bar(i, 106, 105.5);
    });
    const pivots = [lowPivot(10, 100), lowPivot(50, 102)];
    const lines = detectTrendlines({ candles, pivots, atr: 1 });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.side, "support");
    assert.deepEqual(
      lines[0]!.anchors.map((p) => p.index),
      [10, 50],
    );
  });

  it("a 3-touch flatter line outranks a 2-touch steeper one", () => {
    // Flat collinear lows at (10,100) (30,101) (50,102); a late steep pair
    // (52,103)→(60,107). Closes ride the steep line at the end so both
    // envelopes hold — the flat line must still win on touch count.
    const steepAt = (i: number) => 103 + 0.5 * (i - 52);
    const candles = Array.from({ length: 70 }, (_, i) =>
      bar(i, i >= 52 ? steepAt(i) + 1 : 104),
    );
    const pivots = [
      lowPivot(10, 100),
      lowPivot(30, 101),
      lowPivot(50, 102),
      lowPivot(52, 103),
      lowPivot(60, 107),
    ];
    const lines = detectTrendlines({ candles, pivots, atr: 1 });
    assert.ok(lines.length >= 1);
    const top = lines[0]!;
    assert.equal(top.side, "support");
    assert.ok(top.touches >= 3, `expected ≥3 touches, got ${top.touches}`);
    assert.ok(Math.abs(top.slope) < 0.1, "the flatter line wins");
    assert.deepEqual(top.anchors.map((p) => p.index), [10, 50]);
  });

  it("refuses anchor pairs whose second anchor is older than 100 bars", () => {
    const make = (length: number) =>
      Array.from({ length }, (_, i) => {
        if (i === 10) return bar(i, 106, 100);
        if (i === 40) return bar(i, 106, 100.6);
        return bar(i, 106, 105.5);
      });
    const pivots = [lowPivot(10, 100), lowPivot(40, 100.6)];
    // 200 bars → the second anchor is 159 bars old → rejected.
    assert.deepEqual(detectTrendlines({ candles: make(200), pivots, atr: 1 }), []);
    // 120 bars → 79 bars old → accepted.
    const recent = detectTrendlines({ candles: make(120), pivots, atr: 1 });
    assert.equal(recent.length, 1);
    assert.ok(recent[0]!.confidence >= 60);
  });
});

describe("plateau pivots", () => {
  it("an equal-low plateau yields exactly one pivot, on the first bar", () => {
    const candles = Array.from({ length: 20 }, (_, i) =>
      candle(i, i === 8 || i === 9 ? 100 : 105, 106),
    );
    const lows = confirmedPivots(candles, "low");
    assert.equal(lows.length, 1);
    assert.equal(lows[0]!.index, 8);
    assert.equal(lows[0]!.price, 100);
  });

  it("an equal-high plateau yields exactly one pivot, on the first bar", () => {
    const candles = Array.from({ length: 20 }, (_, i) =>
      candle(i, 99, i === 8 || i === 9 ? 110 : 105),
    );
    const highs = confirmedPivots(candles, "high");
    assert.equal(highs.length, 1);
    assert.equal(highs[0]!.index, 8);
    assert.equal(highs[0]!.price, 110);
  });
});
