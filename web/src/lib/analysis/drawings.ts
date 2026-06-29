import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import type { ChartDrawing, DrawingType, PatternTypeName, SemanticRole } from "@/lib/chartDrawings";
import { normalizeTimestamp } from "@/lib/chart/chartTimeAnchor";
import { barsAheadFor, type Pivot } from "./pivots";

/** Candle time at pivot index (normalized ms). */
export function timeAt(candles: OhlcCandle[], index: number): number {
  const c = candles[index];
  if (!c) return 0;
  return normalizeTimestamp(c.time);
}

export function pointFromPivot(pivot: Pivot, candles: OhlcCandle[]): { time: number; price: number } {
  return { time: timeAt(candles, pivot.index), price: pivot.price };
}

export function polylineFromPivots(
  pivots: Pivot[],
  candles: OhlcCandle[],
  confidence: number,
  label: string,
  patternType?: PatternTypeName,
  semanticRole: SemanticRole = "pattern",
): ChartDrawing {
  return {
    type: "polyline_pattern",
    confidence,
    label,
    semanticRole,
    patternType,
    anchorMode: "time_price",
    points: pivots.map((p) => pointFromPivot(p, candles)),
  };
}

export function necklineDrawing(
  a: Pivot,
  b: Pivot,
  candles: OhlcCandle[],
  price: number,
  confidence: number,
  label = "خط العنق",
): ChartDrawing {
  return {
    type: "neckline",
    confidence,
    label,
    semanticRole: "neckline",
    anchorMode: "time_price",
    points: [
      { time: timeAt(candles, a.index), price },
      { time: timeAt(candles, b.index), price },
    ],
  };
}

export function rangeBoxDrawing(
  fromIndex: number,
  toIndex: number,
  priceTop: number,
  priceBottom: number,
  candles: OhlcCandle[],
  confidence: number,
  label: string,
  semanticRole: SemanticRole = "range",
): ChartDrawing {
  const top = Math.max(priceTop, priceBottom);
  const bottom = Math.min(priceTop, priceBottom);
  return {
    type: "range_box",
    confidence,
    label,
    semanticRole,
    anchorMode: "time_price",
    fill: true,
    points: [
      { time: timeAt(candles, fromIndex), price: top },
      { time: timeAt(candles, toIndex), price: bottom },
    ],
  };
}

export function priceLineDrawing(
  price: number,
  confidence: number,
  label: string,
  candles: OhlcCandle[],
  color?: string,
  semanticRole: SemanticRole = "support",
): ChartDrawing {
  const last = candles[candles.length - 1];
  return {
    type: "price_line",
    confidence,
    label,
    color,
    semanticRole,
    anchorMode: "time_price",
    points: [{ time: last ? timeAt(candles, candles.length - 1) : 0, price }],
    price,
  };
}

export function segmentFromPivots(
  a: Pivot,
  b: Pivot,
  candles: OhlcCandle[],
  confidence: number,
  label: string,
  type: DrawingType = "trend_line",
): ChartDrawing {
  return {
    type,
    confidence,
    label,
    semanticRole: type === "trend_line" ? "trendline" : undefined,
    anchorMode: "time_price",
    points: [pointFromPivot(a, candles), pointFromPivot(b, candles)],
  };
}

export function zoneDrawing(
  priceTop: number,
  priceBottom: number,
  fromIndex: number,
  toIndex: number,
  candles: OhlcCandle[],
  confidence: number,
  label: string,
  color?: string,
  semanticRole: SemanticRole = "demand_zone",
): ChartDrawing {
  const top = Math.max(priceTop, priceBottom);
  const bottom = Math.min(priceTop, priceBottom);
  return {
    type: "zone",
    confidence,
    label,
    color,
    semanticRole,
    fill: true,
    anchorMode: "time_price",
    points: [
      { time: timeAt(candles, fromIndex), price: top },
      { time: timeAt(candles, toIndex), price: bottom },
    ],
    price: top,
    price2: bottom,
  };
}

export function fibDrawing(
  swingHigh: number,
  swingLow: number,
  highIndex: number,
  lowIndex: number,
  candles: OhlcCandle[],
  confidence: number,
  levels: { ratio: number; price: number }[],
): ChartDrawing {
  return {
    type: "fib_retracement",
    confidence,
    label: "Fibonacci",
    anchorMode: "time_price",
    points: [
      { time: timeAt(candles, highIndex), price: swingHigh },
      { time: timeAt(candles, lowIndex), price: swingLow },
    ],
    meta: { levels },
  };
}

export function forecastPathDrawing(
  points: { barsAhead: number; price: number; time?: number }[],
  confidence: number,
  label = "السيناريو المتوقع",
): ChartDrawing {
  return {
    type: "forecast_path",
    confidence,
    label,
    semanticRole: "forecast",
    style: "dashed",
    points,
  };
}

export function channelDrawing(
  upper: [Pivot, Pivot],
  lower: [Pivot, Pivot],
  candles: OhlcCandle[],
  confidence: number,
  label: string,
): ChartDrawing {
  return {
    type: "channel",
    confidence,
    label,
    semanticRole: "channel",
    anchorMode: "time_price",
    points: [
      pointFromPivot(upper[0], candles),
      pointFromPivot(upper[1], candles),
      pointFromPivot(lower[0], candles),
      pointFromPivot(lower[1], candles),
    ],
  };
}

export function triangleDrawing(
  p1: Pivot,
  p2: Pivot,
  p3: Pivot,
  candles: OhlcCandle[],
  confidence: number,
  label: string,
  patternType?: PatternTypeName,
): ChartDrawing {
  return {
    type: "triangle",
    confidence,
    label,
    patternType,
    semanticRole: "pattern",
    anchorMode: "time_price",
    points: [
      pointFromPivot(p1, candles),
      pointFromPivot(p2, candles),
      pointFromPivot(p3, candles),
    ],
  };
}

/** Legacy barsAhead helper — only for forecast paths. */
export { barsAheadFor };
