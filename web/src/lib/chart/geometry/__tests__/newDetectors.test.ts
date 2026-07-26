import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeometryCandle } from "@/lib/chart/geometry";
import { zigzagPivots, geometryAtr } from "@/lib/chart/geometry";
import { detectRectangles } from "@/lib/chart/geometry/rectangles";
import { detectTripleExtremes } from "@/lib/chart/geometry/tripleExtremes";
import { detectCupHandle } from "@/lib/chart/geometry/cupHandle";

/**
 * Golden and negative fixtures for the three new detector families.
 *
 * The negative cases matter more than the golden ones. These are the shapes
 * people most want to see where they are not — a cup in every dip, a rectangle
 * in every pause — and a detector that names them loosely feeds the model
 * invented structure, which is the exact failure the doctrine forbids.
 */
const START = 1_700_000_000_000;
const BAR_MS = 900_000;

function candle(index: number, low: number, high: number, close?: number): GeometryCandle {
  const mid = (low + high) / 2;
  return { time: START + index * BAR_MS, open: mid, high, low, close: close ?? mid };
}

/** Walk price through pivot levels with `step` bars between them, range ~1. */
function swings(levels: number[], step = 5): GeometryCandle[] {
  const candles: GeometryCandle[] = [];
  let index = 0;
  for (let i = 0; i < levels.length - 1; i++) {
    const from = levels[i]!;
    const to = levels[i + 1]!;
    for (let s = 0; s < step; s++) {
      const t = s / step;
      const price = from + (to - from) * t;
      candles.push(candle(index++, price - 0.5, price + 0.5, price));
    }
  }
  const last = levels[levels.length - 1]!;
  candles.push(candle(index++, last - 0.5, last + 0.5, last));
  return candles;
}

function detectorInput(candles: GeometryCandle[]) {
  const atr = geometryAtr(candles);
  return { input: { candles, atr }, zigzag: zigzagPivots(candles, atr) };
}

describe("rectangle", () => {
  it("finds a flat band with two touches on each boundary", () => {
    // 100 → 110 → 100 → 110 → 100 → mid: flat top, flat bottom.
    const { input, zigzag } = detectorInput(swings([100, 110, 100, 110, 100, 105], 7));
    const found = detectRectangles(input, zigzag);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.patternType, "rectangle");
    assert.equal(found[0]!.status, "forming");
  });

  it("completes on a close beyond the top, with an upward break", () => {
    const { input, zigzag } = detectorInput(
      swings([100, 110, 100, 110, 100, 116], 7),
    );
    const found = detectRectangles(input, zigzag);
    assert.equal(found[0]?.status, "completed");
    assert.equal(found[0]?.breakDirection, "up");
    assert.ok((found[0]?.projectedTarget ?? 0) > 110, "target projects the band height");
  });

  it("refuses converging boundaries — that is a triangle, not a rectangle", () => {
    // Highs descending 110→107→104: a triangle detector's shape.
    const { input, zigzag } = detectorInput(swings([100, 110, 100.5, 107, 101, 104], 7));
    assert.deepEqual(detectRectangles(input, zigzag), []);
  });

  it("refuses a band flatter than the noise", () => {
    const { input, zigzag } = detectorInput(swings([100, 100.8, 100.1, 100.9, 100.2], 7));
    assert.deepEqual(detectRectangles(input, zigzag), []);
  });
});

describe("triple top / bottom", () => {
  const tripleTop = [100, 110, 104, 110.2, 103.5, 109.9, 104];

  it("finds three defended touches on one level", () => {
    const { input, zigzag } = detectorInput(swings(tripleTop, 7));
    const found = detectTripleExtremes(input, zigzag);
    const top = found.find((p) => p.patternType === "triple_top");
    assert.ok(top, "expected a triple top");
    assert.equal(top.status, "forming");
    assert.equal(top.breakDirection, "down");
    assert.equal(top.anchors.length, 5);
  });

  it("uses the conservative neckline — the lower counter-pivot", () => {
    const { input, zigzag } = detectorInput(swings(tripleTop, 7));
    const top = detectTripleExtremes(input, zigzag).find(
      (p) => p.patternType === "triple_top",
    )!;
    // Counter-pivots sat at 104 and 103.5; completion must wait for the LOWER,
    // so the shallower pullback cannot declare the break early.
    assert.ok(Math.abs(top.neckline!.to.price - 103.5) < 0.6, String(top.neckline!.to.price));
  });

  it("completes when the neckline breaks", () => {
    const { input, zigzag } = detectorInput(swings([...tripleTop, 100], 7));
    const top = detectTripleExtremes(input, zigzag).find(
      (p) => p.patternType === "triple_top",
    );
    assert.equal(top?.status, "completed");
  });

  it("invalidates when the level gives way upward instead", () => {
    const { input, zigzag } = detectorInput(swings([...tripleTop, 113], 7));
    const top = detectTripleExtremes(input, zigzag).find(
      (p) => p.patternType === "triple_top",
    );
    assert.equal(top?.status, "invalidated");
  });

  it("refuses three highs that do not share a level", () => {
    const { input, zigzag } = detectorInput(swings([100, 110, 104, 113, 103, 117, 104], 7));
    assert.equal(
      detectTripleExtremes(input, zigzag).find((p) => p.patternType === "triple_top"),
      undefined,
      "ascending highs are a trend, not a triple top",
    );
  });

  it("finds the mirror-image triple bottom", () => {
    const { input, zigzag } = detectorInput(
      swings([110, 100, 106, 99.8, 106.5, 100.1, 106], 7),
    );
    const bottom = detectTripleExtremes(input, zigzag).find(
      (p) => p.patternType === "triple_bottom",
    );
    assert.ok(bottom);
    assert.equal(bottom.breakDirection, "up");
  });
});

describe("cup and handle", () => {
  // Rim 110, rounded base to 100 mid-span, recovery, shallow handle to 106.
  const cup = [104, 110, 106, 102, 100, 102, 106, 110, 106.5, 108];

  it("finds a rounded base with a shallow handle", () => {
    const { input, zigzag } = detectorInput(swings(cup, 5));
    const found = detectCupHandle(input, zigzag).find(
      (p) => p.patternType === "cup_and_handle",
    );
    assert.ok(found, "expected a cup and handle");
    assert.equal(found.breakDirection, "up");
  });

  it("completes on the rim break", () => {
    const { input, zigzag } = detectorInput(swings([...cup, 113], 5));
    const found = detectCupHandle(input, zigzag).find(
      (p) => p.patternType === "cup_and_handle",
    );
    assert.equal(found?.status, "completed");
  });

  it("refuses a handle that gives back most of the cup", () => {
    // Handle plunging to 101: the base did not hold. Calling this a handle is
    // how a failed base gets dressed up as a continuation setup.
    const { input, zigzag } = detectorInput(
      swings([104, 110, 106, 102, 100, 102, 106, 110, 101, 103], 5),
    );
    assert.equal(
      detectCupHandle(input, zigzag).find((p) => p.patternType === "cup_and_handle"),
      undefined,
    );
  });

  it("refuses a V-spike — the base must be rounded", () => {
    // Bottom hugging the second rim: spike-and-recover, not a cup.
    const { input, zigzag } = detectorInput(
      swings([104, 110, 109.5, 109, 100, 110, 107, 108.5], 5),
    );
    assert.equal(
      detectCupHandle(input, zigzag).find((p) => p.patternType === "cup_and_handle"),
      undefined,
    );
  });

  it("finds the inverse cup mirrored downward", () => {
    const { input, zigzag } = detectorInput(
      swings([106, 100, 104, 108, 110, 108, 104, 100, 103.5, 102], 5),
    );
    const found = detectCupHandle(input, zigzag).find(
      (p) => p.patternType === "inverse_cup_and_handle",
    );
    assert.ok(found, "expected an inverse cup");
    assert.equal(found.breakDirection, "down");
  });
});

describe("determinism", () => {
  it("returns byte-identical output for identical input", () => {
    const fixtures = [
      swings([100, 110, 100, 110, 100, 105], 7),
      swings([100, 110, 104, 110.2, 103.5, 109.9, 104], 7),
      swings([104, 110, 106, 102, 100, 102, 106, 110, 106.5, 108], 5),
    ];
    for (const candles of fixtures) {
      const { input, zigzag } = detectorInput(candles);
      const once = JSON.stringify([
        detectRectangles(input, zigzag),
        detectTripleExtremes(input, zigzag),
        detectCupHandle(input, zigzag),
      ]);
      const twice = JSON.stringify([
        detectRectangles(input, zigzag),
        detectTripleExtremes(input, zigzag),
        detectCupHandle(input, zigzag),
      ]);
      assert.equal(once, twice);
    }
  });
});
