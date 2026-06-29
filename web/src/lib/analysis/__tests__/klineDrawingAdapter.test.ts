import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  drawingsToOverlays,
  drawingToOverlay,
  drawingId,
} from "@/lib/chart/klineDrawingAdapter";

test("price_line maps to a single-point priceLine overlay", () => {
  const d: ChartDrawing = {
    type: "price_line",
    confidence: 80,
    label: "دعم",
    points: [{ barsAhead: 0, price: 1.2345 }],
    price: 1.2345,
  };
  const spec = drawingToOverlay(d, 99, "x")!;
  assert.equal(spec.name, "priceLine");
  assert.equal(spec.points.length, 1);
  assert.equal(spec.points[0]!.value, 1.2345);
  assert.equal(spec.lock, true);
});

test("trend_line maps barsAhead to dataIndex (lastIndex + offset)", () => {
  const d: ChartDrawing = {
    type: "trend_line",
    confidence: 70,
    points: [
      { barsAhead: -10, price: 1.1 },
      { barsAhead: -2, price: 1.2 },
    ],
  };
  const spec = drawingToOverlay(d, 100, "x")!;
  assert.equal(spec.name, "segment");
  assert.deepEqual(
    spec.points.map((p) => p.dataIndex),
    [90, 98],
  );
});

test("forecast_path renders dashed", () => {
  const d: ChartDrawing = {
    type: "forecast_path",
    confidence: 60,
    points: [
      { barsAhead: 0, price: 1.2 },
      { barsAhead: 5, price: 1.25 },
    ],
  };
  const spec = drawingToOverlay(d, 50, "x")!;
  assert.equal((spec.styles?.line as Record<string, unknown>)?.style, "dashed");
});

test("fib_retracement maps to fibonacciLine", () => {
  const d: ChartDrawing = {
    type: "fib_retracement",
    confidence: 65,
    points: [
      { barsAhead: -20, price: 1.3 },
      { barsAhead: -5, price: 1.2 },
    ],
  };
  assert.equal(drawingToOverlay(d, 80, "x")!.name, "fibonacciLine");
});

test("channel needs 3 points; fewer is skipped", () => {
  const two: ChartDrawing = {
    type: "channel",
    confidence: 66,
    points: [
      { barsAhead: -10, price: 1.2 },
      { barsAhead: -2, price: 1.25 },
    ],
  };
  assert.equal(drawingToOverlay(two, 50, "x"), null);
});

test("zone maps to a filled rect", () => {
  const d: ChartDrawing = {
    type: "zone",
    confidence: 70,
    fill: true,
    color: "#22c55e",
    points: [
      { barsAhead: -8, price: 1.25 },
      { barsAhead: 0, price: 1.2 },
    ],
  };
  const spec = drawingToOverlay(d, 40, "x")!;
  assert.equal(spec.name, "rect");
  assert.ok(spec.styles?.polygon);
});

test("flat price coords (no points[]) still render", () => {
  const d: ChartDrawing = {
    type: "price_line",
    confidence: 75,
    points: [],
    price: 1.999,
  };
  const spec = drawingToOverlay(d, 10, "x")!;
  assert.equal(spec.points[0]!.value, 1.999);
});

test("drawingsToOverlays assigns stable, unique ids", () => {
  const drawings: ChartDrawing[] = [
    { type: "price_line", confidence: 70, label: "دعم", points: [{ barsAhead: 0, price: 1 }] },
    { type: "price_line", confidence: 70, label: "مقاومة", points: [{ barsAhead: 0, price: 2 }] },
  ];
  const specs = drawingsToOverlays(drawings, 100);
  assert.equal(specs.length, 2);
  assert.notEqual(specs[0]!.id, specs[1]!.id);
  // ids are deterministic for the same input
  assert.equal(specs[0]!.id, drawingId(drawings[0]!, 0));
});
