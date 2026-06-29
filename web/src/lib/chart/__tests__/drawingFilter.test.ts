import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { filterAndCapDrawings } from "@/lib/chart/drawingFilter";
import { normalizeChartLabel } from "@/lib/chart/chartTerminology";

test("normalizeChartLabel replaces vague labels", () => {
  assert.equal(normalizeChartLabel("فوق", "resistance"), "مقاومة");
  assert.equal(normalizeChartLabel("تحت", "support"), "دعم");
  assert.equal(normalizeChartLabel("neckline", "neckline"), "خط العنق");
});

test("filterAndCapDrawings caps price_line at 3", () => {
  const drawings: ChartDrawing[] = Array.from({ length: 6 }, (_, i) => ({
    type: "price_line" as const,
    confidence: 60 + i,
    points: [{ time: 1000 + i, price: 1 + i * 0.01 }],
  }));
  const out = filterAndCapDrawings(drawings);
  assert.equal(out.filter((d) => d.type === "price_line").length, 3);
});

test("filterAndCapDrawings removes risk_reward on wait", () => {
  const drawings: ChartDrawing[] = [
    {
      type: "risk_reward_box",
      confidence: 80,
      points: [
        { time: 1000, price: 1.1 },
        { time: 2000, price: 1.08 },
      ],
    },
    {
      type: "range_box",
      confidence: 70,
      points: [
        { time: 1000, price: 1.12 },
        { time: 2000, price: 1.08 },
      ],
    },
  ];
  const out = filterAndCapDrawings(drawings, { decision: "wait" });
  assert.equal(out.some((d) => d.type === "risk_reward_box"), false);
  assert.equal(out.some((d) => d.type === "range_box"), true);
});

test("filterAndCapDrawings max 7 total", () => {
  const drawings: ChartDrawing[] = Array.from({ length: 12 }, (_, i) => ({
    type: (i % 2 === 0 ? "polyline_pattern" : "range_box") as ChartDrawing["type"],
    confidence: 50 + i,
    points: [
      { time: 1000 + i, price: 1.1 },
      { time: 2000 + i, price: 1.08 },
    ],
  }));
  assert.equal(filterAndCapDrawings(drawings).length, 7);
});
