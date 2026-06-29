import type { ChartDrawing, DrawingType } from "@/lib/chartDrawings";
import { barsAheadFor, type Pivot } from "./pivots";

/**
 * Builders that turn analysis primitives into the existing ChartDrawing schema
 * (kept as-is). All offsets are bars-ahead relative to the last candle so the
 * KLineCharts adapter and the EA both render them consistently.
 */

export function priceLineDrawing(
  price: number,
  confidence: number,
  label: string,
  color?: string,
): ChartDrawing {
  return {
    type: "price_line",
    confidence,
    label,
    color,
    points: [{ barsAhead: 0, price }],
    price,
  };
}

export function segmentFromPivots(
  a: Pivot,
  b: Pivot,
  candleCount: number,
  confidence: number,
  label: string,
  type: DrawingType = "trend_line",
): ChartDrawing {
  return {
    type,
    confidence,
    label,
    points: [
      { barsAhead: barsAheadFor(a.index, candleCount), price: a.price },
      { barsAhead: barsAheadFor(b.index, candleCount), price: b.price },
    ],
  };
}

export function zoneDrawing(
  priceTop: number,
  priceBottom: number,
  fromIndex: number,
  candleCount: number,
  confidence: number,
  label: string,
  color?: string,
): ChartDrawing {
  const top = Math.max(priceTop, priceBottom);
  const bottom = Math.min(priceTop, priceBottom);
  return {
    type: "zone",
    confidence,
    label,
    color,
    fill: true,
    points: [
      { barsAhead: barsAheadFor(fromIndex, candleCount), price: top },
      { barsAhead: 0, price: bottom },
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
  candleCount: number,
  confidence: number,
  levels: { ratio: number; price: number }[],
): ChartDrawing {
  return {
    type: "fib_retracement",
    confidence,
    label: "Fibonacci",
    points: [
      { barsAhead: barsAheadFor(highIndex, candleCount), price: swingHigh },
      { barsAhead: barsAheadFor(lowIndex, candleCount), price: swingLow },
    ],
    meta: { levels },
  };
}

export function forecastPathDrawing(
  points: { barsAhead: number; price: number }[],
  confidence: number,
  label = "السيناريو المتوقع",
): ChartDrawing {
  return {
    type: "forecast_path",
    confidence,
    label,
    style: "dashed",
    points,
  };
}

export function channelDrawing(
  upper: [Pivot, Pivot],
  lower: [Pivot, Pivot],
  candleCount: number,
  confidence: number,
  label: string,
): ChartDrawing {
  return {
    type: "channel",
    confidence,
    label,
    points: [
      { barsAhead: barsAheadFor(upper[0].index, candleCount), price: upper[0].price },
      { barsAhead: barsAheadFor(upper[1].index, candleCount), price: upper[1].price },
      { barsAhead: barsAheadFor(lower[0].index, candleCount), price: lower[0].price },
      { barsAhead: barsAheadFor(lower[1].index, candleCount), price: lower[1].price },
    ],
  };
}
