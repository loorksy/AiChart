/**
 * Shared geometry types. The engine is PURE and agent-independent: it imports
 * nothing from lib/agent, so the decision path, PNG snapshots, and MCP numeric
 * context can all consume the same detections. Deterministic by contract —
 * the same candles always produce the same snapshot.
 */
import type { PatternTypeName } from "@/lib/chartDrawings";

/** Structural candle shape — compatible with AgentCandle and OhlcCandle. */
export interface GeometryCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface GeometryPivot {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
}

export type PatternStatus = "forming" | "completed" | "invalidated";

export interface TrendlineGeometry {
  side: "support" | "resistance";
  anchors: [GeometryPivot, GeometryPivot];
  /** Price change per bar. */
  slope: number;
  touches: number;
  candleSeparation: number;
  /** Line price extended to the last candle's time. */
  priceAtLastBar: number;
  broken: boolean;
  confidence: number;
  evidence: string[];
}

export interface ChannelGeometry {
  direction: "rising" | "falling" | "horizontal";
  /** The base trendline the channel was built from. */
  base: TrendlineGeometry;
  /** Two points defining the parallel boundary. */
  parallel: [GeometryPivot, GeometryPivot];
  widthAtr: number;
  oppositeTouches: number;
  confidence: number;
  evidence: string[];
}

export interface PatternInstance {
  patternType: PatternTypeName;
  status: PatternStatus;
  /** Chronological anchor points tracing the pattern shape. */
  anchors: GeometryPivot[];
  /** Horizontal or sloped break level, when the pattern has one. */
  neckline?: { from: { time: number; price: number }; to: { time: number; price: number } };
  /** Measured-move projection once the pattern completes. */
  projectedTarget?: number;
  /** Break direction implied by the pattern (long/short bias on completion). */
  breakDirection?: "up" | "down";
  confidence: number;
  evidence: string[];
}

export interface GeometrySnapshot {
  /** Zigzag pivots the detections were built from (bounded, chronological). */
  pivots: GeometryPivot[];
  trendlines: TrendlineGeometry[];
  channels: ChannelGeometry[];
  patterns: PatternInstance[];
  /** Window actually analysed (after the 500-bar cap). */
  candleCount: number;
  atr: number;
}

export interface GeometryDetectorInput {
  candles: GeometryCandle[];
  pivots: GeometryPivot[];
  atr: number;
}

/** Price of the line through (a, b) evaluated at `time`. */
export function linePriceAt(
  a: { time: number; price: number },
  b: { time: number; price: number },
  time: number,
): number {
  if (b.time === a.time) return a.price;
  const t = (time - a.time) / (b.time - a.time);
  return a.price + t * (b.price - a.price);
}

/** Price of the line through (a, b) evaluated at a candle INDEX (bar space). */
export function linePriceAtIndex(
  a: GeometryPivot,
  b: GeometryPivot,
  index: number,
): number {
  if (b.index === a.index) return a.price;
  const t = (index - a.index) / (b.index - a.index);
  return a.price + t * (b.price - a.price);
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
