import assert from "node:assert/strict";
import { test } from "node:test";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import { detectPatterns } from "../patterns";
import { extractPivots } from "../pivots";

/**
 * Build candles from turning prices. Each segment linearly interpolates
 * `spacing` bars between consecutive control prices; high/low carry a small
 * wick so local extrema register as clean swing pivots (lookback 2).
 */
function build(controls: number[], spacing = 4): OhlcCandle[] {
  const path: number[] = [];
  // leading filler so the first control can become an interior pivot
  for (let i = 0; i < 3; i++) path.push(controls[0]!);
  for (let s = 0; s < controls.length - 1; s++) {
    const a = controls[s]!;
    const b = controls[s + 1]!;
    for (let k = 1; k <= spacing; k++) path.push(a + ((b - a) * k) / spacing);
  }
  for (let i = 0; i < 3; i++) path.push(controls[controls.length - 1]!);

  let prev = path[0]!;
  return path.map((p, i) => {
    const c: OhlcCandle = {
      time: i * 60_000,
      open: prev,
      close: p,
      high: Math.max(prev, p) + Math.abs(p) * 0.0005,
      low: Math.min(prev, p) - Math.abs(p) * 0.0005,
    };
    prev = p;
    return c;
  });
}

test("extractPivots alternates high/low", () => {
  const candles = build([100, 110, 104, 112, 106]);
  const pivots = extractPivots(candles);
  assert.ok(pivots.length >= 3, "should find several pivots");
  for (let i = 1; i < pivots.length; i++) {
    assert.notEqual(pivots[i]!.kind, pivots[i - 1]!.kind, "pivots must alternate");
  }
});

test("detects double top (M)", () => {
  // up to 110, pullback to 103, back to ~110, then drop
  const candles = build([100, 110, 103, 110.2, 104]);
  const pats = detectPatterns(candles);
  const dt = pats.find((p) => p.type === "double_top");
  assert.ok(dt, "double top detected");
  assert.equal(dt!.bias, "bearish");
  assert.ok(dt!.breakLevel < 110 && dt!.breakLevel > 100, "neckline at the trough");
  assert.ok(dt!.target < dt!.breakLevel, "measured move points down");
});

test("detects double bottom (W)", () => {
  const candles = build([110, 100, 107, 99.8, 106]);
  const pats = detectPatterns(candles);
  const db = pats.find((p) => p.type === "double_bottom");
  assert.ok(db, "double bottom detected");
  assert.equal(db!.bias, "bullish");
  assert.ok(db!.target > db!.breakLevel, "measured move points up");
});

test("detects head and shoulders", () => {
  // left shoulder 108, head 115, right shoulder 108, neckline troughs ~102
  const candles = build([100, 108, 102, 115, 102, 108, 101]);
  const pats = detectPatterns(candles);
  const hs = pats.find((p) => p.type === "head_and_shoulders");
  assert.ok(hs, "H&S detected");
  assert.equal(hs!.bias, "bearish");
  assert.ok(hs!.target < hs!.breakLevel);
});

test("detects inverse head and shoulders", () => {
  const candles = build([110, 102, 108, 95, 108, 102, 109]);
  const pats = detectPatterns(candles);
  const ihs = pats.find((p) => p.type === "inverse_head_and_shoulders");
  assert.ok(ihs, "inverse H&S detected");
  assert.equal(ihs!.bias, "bullish");
  assert.ok(ihs!.target > ihs!.breakLevel);
});

test("detects ascending triangle (flat highs, rising lows)", () => {
  // highs ~120 flat; lows rising 100 -> 108 -> 114
  const candles = build([100, 120, 108, 120.1, 114, 120.05, 117]);
  const pats = detectPatterns(candles);
  const at = pats.find((p) => p.type === "ascending_triangle");
  assert.ok(at, "ascending triangle detected");
  assert.equal(at!.bias, "bullish");
});

test("no false patterns on a clean monotonic ramp", () => {
  const ramp = build([100, 101, 102, 103, 104], 6);
  const pats = detectPatterns(ramp);
  assert.ok(
    !pats.some((p) => p.type === "double_top" || p.type === "head_and_shoulders"),
    "monotonic ramp should not yield reversal tops",
  );
});
