import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  drawingsToOverlays,
  drawingToOverlay,
  drawingId,
} from "@/lib/chart/klineDrawingAdapter";

const CANDLES = Array.from({ length: 101 }, (_, i) => ({
  timestamp: 1_700_000_000_000 + i * 3_600_000,
}));

test("price_line maps to priceLine with time anchor", () => {
  const d: ChartDrawing = {
    type: "price_line",
    confidence: 80,
    label: "دعم",
    points: [{ time: CANDLES[100]!.timestamp, price: 1.2345 }],
    price: 1.2345,
  };
  const spec = drawingToOverlay(d, CANDLES, "x")!;
  assert.equal(spec.name, "priceLine");
  assert.equal(spec.points.length, 1);
  assert.equal(spec.points[0]!.value, 1.2345);
  assert.equal(spec.points[0]!.dataIndex, 100);
});

test("trend_line uses time-based dataIndex", () => {
  const d: ChartDrawing = {
    type: "trend_line",
    confidence: 70,
    points: [
      { time: CANDLES[90]!.timestamp, price: 1.1 },
      { time: CANDLES[98]!.timestamp, price: 1.2 },
    ],
  };
  const spec = drawingToOverlay(d, CANDLES, "x")!;
  assert.equal(spec.name, "segment");
  assert.deepEqual(
    spec.points.map((p) => p.dataIndex),
    [90, 98],
  );
});

test("forecast_path renders dashed with barsAhead", () => {
  const d: ChartDrawing = {
    type: "forecast_path",
    confidence: 60,
    points: [
      { time: CANDLES[100]!.timestamp, price: 1.2 },
      { barsAhead: 5, price: 1.25 },
    ],
  };
  const spec = drawingToOverlay(d, CANDLES, "x")!;
  assert.equal((spec.styles?.line as Record<string, unknown>)?.style, "dashed");
});

test("triangle maps to triangle overlay not segment", () => {
  const d: ChartDrawing = {
    type: "triangle",
    confidence: 70,
    points: [
      { time: CANDLES[80]!.timestamp, price: 1.2 },
      { time: CANDLES[90]!.timestamp, price: 1.15 },
      { time: CANDLES[100]!.timestamp, price: 1.18 },
    ],
  };
  assert.equal(drawingToOverlay(d, CANDLES, "x")!.name, "triangle");
});

test("zone maps to rangeBox", () => {
  const d: ChartDrawing = {
    type: "zone",
    confidence: 70,
    fill: true,
    color: "#22c55e",
    points: [
      { time: CANDLES[92]!.timestamp, price: 1.25 },
      { time: CANDLES[100]!.timestamp, price: 1.2 },
    ],
  };
  const spec = drawingToOverlay(d, CANDLES, "x")!;
  assert.equal(spec.name, "rangeBox");
});

test("drawingsToOverlays assigns stable unique ids", () => {
  const drawings: ChartDrawing[] = [
    {
      type: "price_line",
      confidence: 70,
      label: "دعم",
      points: [{ time: CANDLES[100]!.timestamp, price: 1 }],
    },
    {
      type: "price_line",
      confidence: 70,
      label: "مقاومة",
      points: [{ time: CANDLES[100]!.timestamp, price: 2 }],
    },
  ];
  const specs = drawingsToOverlays(drawings, CANDLES);
  assert.equal(specs.length, 2);
  assert.notEqual(specs[0]!.id, specs[1]!.id);
  assert.equal(specs[0]!.id, drawingId(drawings[0]!, 0));
});
