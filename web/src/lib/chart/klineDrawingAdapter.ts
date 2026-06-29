import type { ChartDrawing, DrawingType } from "@/lib/chartDrawings";

/**
 * Translates the existing ChartDrawing schema (kept as-is) into KLineCharts
 * overlay descriptors. Pure and DOM-free so it is unit-testable; the KLineChart
 * component feeds the descriptors to `chart.createOverlay(...)`.
 *
 * Mapping:
 *   price_line      → priceLine
 *   trend_line      → segment
 *   forecast_path   → segment (dashed, first→last)
 *   channel         → priceChannelLine (3 points)
 *   zone            → rect (custom registered overlay)
 *   fib_retracement → fibonacciLine
 *   liquidity/break → priceLine (horizontal level)
 *   baseline/marker → priceLine
 */

export interface KLinePoint {
  /** Index into the candle array (lastIndex + barsAhead). */
  dataIndex: number;
  value: number;
}

export interface KLineOverlaySpec {
  /** Stable id so live updates migrate the same overlay instead of stacking. */
  id: string;
  name: string;
  points: KLinePoint[];
  lock: boolean;
  styles?: Record<string, unknown>;
  extendData?: { label?: string; confidence: number };
}

const KLINE_NAME: Record<DrawingType, string> = {
  // semantic
  price_line: "priceLine",
  trend_line: "segment",
  forecast_path: "segment",
  channel: "priceChannelLine",
  zone: "rect",
  fib_retracement: "fibonacciLine",
  baseline: "priceLine",
  marker: "priceLine",
  histogram_band: "rect",
  // MT5-native shapes mapped to nearest KLineCharts primitive
  hline: "priceLine",
  vline: "verticalStraightLine",
  trend: "segment",
  trendline: "segment",
  ray: "rayLine",
  rectangle: "rect",
  triangle: "segment",
  ellipse: "rect",
  arrow_down: "simpleAnnotation",
  arrow_sell: "simpleAnnotation",
  arrow_up: "simpleAnnotation",
  arrow_buy: "simpleAnnotation",
  arrow_stop: "simpleAnnotation",
  arrow_check: "simpleAnnotation",
  arrow_thumb_up: "simpleAnnotation",
  arrow_thumb_down: "simpleAnnotation",
  arrow: "simpleAnnotation",
  fibo: "fibonacciLine",
  fibonacci: "fibonacciLine",
  fibo_fan: "fibonacciLine",
  fibo_arc: "fibonacciLine",
  expansion: "fibonacciLine",
  pitchfork: "segment",
  gann_line: "segment",
  gann_fan: "segment",
  text: "simpleAnnotation",
  label: "simpleAnnotation",
};

function pointsFor(d: ChartDrawing, lastIndex: number): KLinePoint[] {
  // Prefer the points[] array; fall back to flat price/price2/price3 coords.
  if (Array.isArray(d.points) && d.points.length > 0) {
    return d.points.map((p) => ({
      dataIndex: lastIndex + (p.barsAhead ?? 0),
      value: p.price,
    }));
  }
  const flat: KLinePoint[] = [];
  const offs = [d.time_offset ?? 0, d.time_offset2 ?? 0, d.time_offset3 ?? 0];
  [d.price, d.price2, d.price3].forEach((v, i) => {
    if (typeof v === "number" && v > 0) {
      flat.push({ dataIndex: lastIndex + (offs[i] ?? 0), value: v });
    }
  });
  return flat;
}

function styleColor(d: ChartDrawing): string | undefined {
  return d.color ?? d.fill_color;
}

/** One ChartDrawing → one KLineCharts overlay spec (or null when un-renderable). */
export function drawingToOverlay(
  d: ChartDrawing,
  lastIndex: number,
  id: string,
): KLineOverlaySpec | null {
  const name = KLINE_NAME[d.type] ?? "priceLine";
  let points = pointsFor(d, lastIndex);
  if (points.length === 0) return null;

  // Channel needs exactly 3 points for priceChannelLine; trim/skip otherwise.
  if (name === "priceChannelLine") {
    if (points.length < 3) return null;
    points = points.slice(0, 3);
  }
  // Single-point line overlays only need the value.
  if (name === "priceLine") points = [points[0]!];

  const dashed = d.style === "dashed" || d.style === "dotted" || d.type === "forecast_path";
  const color = styleColor(d);
  const styles: Record<string, unknown> = {};
  const lineStyle: Record<string, unknown> = {};
  if (color) lineStyle.color = color;
  if (dashed) lineStyle.style = "dashed";
  if (Object.keys(lineStyle).length) styles.line = lineStyle;
  if (name === "rect") {
    styles.polygon = {
      color: d.fill ? `${color ?? "#6366f1"}22` : "transparent",
      borderColor: color ?? "#6366f1",
    };
  }

  return {
    id,
    name,
    points,
    lock: true,
    styles: Object.keys(styles).length ? styles : undefined,
    extendData: { label: d.label, confidence: d.confidence },
  };
}

/** Stable id for a drawing so progressive SSE updates migrate the same overlay. */
export function drawingId(d: ChartDrawing, index: number): string {
  const key = d.label ? d.label.replace(/\s+/g, "_") : d.type;
  return `dw_${d.type}_${key}_${index}`;
}

/** Map a full ChartDrawing[] to KLineCharts overlay specs with stable ids. */
export function drawingsToOverlays(
  drawings: ChartDrawing[],
  candleCount: number,
): KLineOverlaySpec[] {
  const lastIndex = Math.max(0, candleCount - 1);
  const out: KLineOverlaySpec[] = [];
  drawings.forEach((d, i) => {
    const spec = drawingToOverlay(d, lastIndex, drawingId(d, i));
    if (spec) out.push(spec);
  });
  return out;
}
