import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  nearestCandleIndex,
  normalizeTimestamp,
  pointToKLinePoint,
  enrichDrawingsWithTime,
} from "@/lib/chart/chartTimeAnchor";
import { drawingToOverlay } from "@/lib/chart/klineDrawingAdapter";

const CANDLES = [
  { timestamp: 1_700_000_000_000 },
  { timestamp: 1_700_003_600_000 },
  { timestamp: 1_700_007_200_000 },
  { timestamp: 1_700_010_800_000 },
  { timestamp: 1_700_014_400_000 },
];

test("normalizeTimestamp converts seconds to ms", () => {
  assert.equal(normalizeTimestamp(1700000000), 1700000000000);
  assert.equal(normalizeTimestamp(1700000000000), 1700000000000);
});

test("nearestCandleIndex finds closest candle", () => {
  assert.equal(nearestCandleIndex(CANDLES, 1_700_007_200_000), 2);
  assert.equal(nearestCandleIndex(CANDLES, 1_700_008_000_000), 2);
});

test("pointToKLinePoint uses time not barsAhead for historical points", () => {
  const pt = pointToKLinePoint(
    { time: 1_700_007_200_000, price: 1.105 },
    CANDLES,
    { fallbackLastIndex: 4 },
  );
  assert.ok(pt);
  assert.equal(pt!.dataIndex, 2);
  assert.equal(pt!.value, 1.105);
});

test("pointToKLinePoint rejects barsAhead without allowBarsAhead", () => {
  const pt = pointToKLinePoint({ barsAhead: -2, price: 1.1 }, CANDLES, {
    fallbackLastIndex: 4,
  });
  assert.equal(pt, null);
});

test("forecast_path allows barsAhead on future points", () => {
  const pt = pointToKLinePoint({ barsAhead: 0, price: 1.12 }, CANDLES, {
    allowBarsAhead: true,
    fallbackLastIndex: 4,
  });
  assert.ok(pt);
  assert.equal(pt!.dataIndex, 4);
});

test("enrichDrawingsWithTime fills time from barsAhead", () => {
  const raw: ChartDrawing[] = [
    {
      type: "trend_line",
      confidence: 70,
      points: [
        { barsAhead: -2, price: 1.1 },
        { barsAhead: 0, price: 1.12 },
      ],
    },
  ];
  const candles = CANDLES.map((c) => ({ time: c.timestamp }));
  const out = enrichDrawingsWithTime(raw, candles);
  assert.ok(out[0]!.points[0]!.time);
  assert.ok(out[0]!.points[1]!.time);
});

test("polyline_pattern maps to polylinePattern overlay with time anchor", () => {
  const d: ChartDrawing = {
    type: "polyline_pattern",
    confidence: 80,
    label: "قاع مزدوج",
    patternType: "w_pattern",
    points: [
      { time: 1_700_000_000_000, price: 1.08 },
      { time: 1_700_007_200_000, price: 1.1 },
      { time: 1_700_014_400_000, price: 1.08 },
    ],
  };
  const spec = drawingToOverlay(d, CANDLES, "x")!;
  assert.equal(spec.name, "polylinePattern");
  assert.equal(spec.points.length, 3);
  assert.equal(spec.points[0]!.dataIndex, 0);
  assert.equal(spec.points[2]!.dataIndex, 4);
});

test("same drawing reprojects to same price across candle sets", () => {
  const d: ChartDrawing = {
    type: "range_box",
    confidence: 70,
    points: [
      { time: 1_700_000_000_000, price: 1.12 },
      { time: 1_700_014_400_000, price: 1.08 },
    ],
  };
  const fineCandles = Array.from({ length: 10 }, (_, i) => ({
    timestamp: 1_700_000_000_000 + i * 360_000_000,
  }));
  const spec = drawingToOverlay(d, fineCandles, "x")!;
  assert.equal(spec.points[0]!.value, 1.12);
  assert.equal(spec.points[1]!.value, 1.08);
});
