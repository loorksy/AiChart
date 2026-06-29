import type { ChartDrawing, DrawingType } from "@/lib/chartDrawings";
import { isArrowDrawing, isZoneDrawing } from "@/lib/chartDrawings";
import {
  drawingPointsToKLine,
  isDrawingVisible,
  toCandleLike,
  type AnyCandle,
  type CandleLike,
} from "@/lib/chart/chartTimeAnchor";

export interface KLinePoint {
  dataIndex: number;
  value: number;
  timestamp?: number;
}

export interface KLineOverlaySpec {
  id: string;
  name: string;
  points: KLinePoint[];
  lock: boolean;
  styles?: Record<string, unknown>;
  extendData?: Record<string, unknown>;
}

type OverlayName =
  | "priceLine"
  | "segment"
  | "priceChannelLine"
  | "rect"
  | "rangeBox"
  | "polylinePattern"
  | "triangle"
  | "neckline"
  | "channel"
  | "labeledArrow"
  | "riskRewardBox"
  | "ellipse"
  | "patternLabel"
  | "fibonacciLine"
  | "verticalStraightLine"
  | "rayLine"
  | "simpleAnnotation";

const KLINE_NAME: Partial<Record<DrawingType, OverlayName>> = {
  price_line: "priceLine",
  hline: "priceLine",
  baseline: "priceLine",
  marker: "priceLine",
  trend_line: "segment",
  trend: "segment",
  trendline: "segment",
  pitchfork: "segment",
  gann_line: "segment",
  gann_fan: "segment",
  forecast_path: "segment",
  channel: "channel",
  zone: "rangeBox",
  range_box: "rangeBox",
  supply_zone: "rangeBox",
  demand_zone: "rangeBox",
  decision_zone: "rangeBox",
  retest_zone: "rangeBox",
  histogram_band: "rangeBox",
  rectangle: "rangeBox",
  polyline_pattern: "polylinePattern",
  triangle: "triangle",
  neckline: "neckline",
  breakout_arrow: "labeledArrow",
  labeled_arrow: "labeledArrow",
  risk_reward_box: "riskRewardBox",
  ellipse: "ellipse",
  pattern_label: "patternLabel",
  fib_retracement: "fibonacciLine",
  fibo: "fibonacciLine",
  fibonacci: "fibonacciLine",
  fibo_fan: "fibonacciLine",
  fibo_arc: "fibonacciLine",
  expansion: "fibonacciLine",
  vline: "verticalStraightLine",
  ray: "rayLine",
  arrow: "labeledArrow",
  arrow_up: "labeledArrow",
  arrow_down: "labeledArrow",
  arrow_buy: "labeledArrow",
  arrow_sell: "labeledArrow",
  arrow_stop: "simpleAnnotation",
  arrow_check: "simpleAnnotation",
  arrow_thumb_up: "simpleAnnotation",
  arrow_thumb_down: "simpleAnnotation",
  text: "simpleAnnotation",
  label: "patternLabel",
};

function overlayNameFor(d: ChartDrawing): OverlayName {
  return KLINE_NAME[d.type] ?? "segment";
}

function styleColor(d: ChartDrawing): string | undefined {
  return d.color ?? d.fill_color;
}

function buildStyles(d: ChartDrawing, name: OverlayName): Record<string, unknown> | undefined {
  const color = styleColor(d);
  const dashed = d.style === "dashed" || d.style === "dotted" || d.type === "forecast_path";
  const styles: Record<string, unknown> = {};
  const lineStyle: Record<string, unknown> = {};
  if (color) lineStyle.color = color;
  if (dashed) lineStyle.style = "dashed";
  if (Object.keys(lineStyle).length) styles.line = lineStyle;

  if (name === "rangeBox" || name === "rect") {
    styles.polygon = {
      color: d.fill ? `${color ?? "#6366f1"}22` : "transparent",
      borderColor: color ?? "#6366f1",
      borderSize: 1,
    };
  }
  if (name === "triangle" || name === "ellipse") {
    styles.polygon = {
      color: `${color ?? "#8b5cf6"}18`,
      borderColor: color ?? "#8b5cf6",
      borderSize: 1.5,
    };
  }
  return Object.keys(styles).length ? styles : undefined;
}

function buildExtendData(d: ChartDrawing): Record<string, unknown> {
  const base: Record<string, unknown> = {
    label: d.label,
    confidence: d.confidence,
    semanticRole: d.semanticRole,
    patternType: d.patternType,
    sourceTimeframe: d.meta?.sourceTimeframe,
  };
  if (d.type === "risk_reward_box") {
    base.entry = d.meta?.entry ?? d.price;
    base.stopLoss = d.meta?.stopLoss ?? d.price2;
    base.takeProfit = d.meta?.takeProfit ?? d.price3;
    base.riskReward = d.meta?.riskReward;
  }
  return base;
}

/** One ChartDrawing → one KLineCharts overlay spec (or null when un-renderable). */
export function drawingToOverlay(
  d: ChartDrawing,
  candles: AnyCandle[],
  id: string,
): KLineOverlaySpec | null {
  const like = toCandleLike(candles);
  if (!isDrawingVisible(d, like)) return null;

  let name = overlayNameFor(d);
  let points = drawingPointsToKLine(d, like);
  if (!points || points.length === 0) return null;

  if (name === "priceChannelLine") {
    if (points.length < 3) {
      name = "channel";
      if (points.length < 4 && points.length >= 2) {
        /* keep as segment fallback only for 2-point channel hint */
        name = "segment";
      } else if (points.length >= 4) {
        name = "channel";
        points = points.slice(0, 4);
      }
    } else {
      points = points.slice(0, 3);
    }
  }

  if (name === "priceLine") points = [points[0]!];

  if (name === "polylinePattern" && points.length > 8) {
    points = points.slice(0, 8);
  }

  if (name === "triangle" && points.length >= 3) {
    points = points.slice(0, 3);
  }

  if (name === "neckline" && points.length >= 2) {
    points = points.slice(0, 2);
  }

  if (name === "labeledArrow" && points.length >= 2) {
    points = points.slice(0, 2);
  }

  if (name === "rangeBox" && points.length >= 2) {
    points = points.slice(0, 2);
  }

  if (name === "riskRewardBox" && points.length >= 2) {
    points = points.slice(0, 2);
  }

  return {
    id,
    name,
    points,
    lock: true,
    styles: buildStyles(d, name),
    extendData: buildExtendData(d),
  };
}

export function drawingId(d: ChartDrawing, index: number): string {
  const key = d.label ? d.label.replace(/\s+/g, "_") : d.type;
  return `dw_${d.type}_${key}_${index}`;
}

/** Map ChartDrawing[] to KLineCharts overlay specs using time+price anchoring. */
export function drawingsToOverlays(
  drawings: ChartDrawing[],
  candles: AnyCandle[],
): KLineOverlaySpec[] {
  const out: KLineOverlaySpec[] = [];
  drawings.forEach((d, i) => {
    const spec = drawingToOverlay(d, candles, drawingId(d, i));
    if (spec) out.push(spec);
  });
  return out;
}

/** @deprecated use drawingsToOverlays(drawings, candles) */
export function drawingsToOverlaysLegacy(
  drawings: ChartDrawing[],
  candleCount: number,
): KLineOverlaySpec[] {
  const candles: CandleLike[] = Array.from({ length: candleCount }, (_, i) => ({
    timestamp: i,
  }));
  return drawingsToOverlays(drawings, candles);
}

export { isZoneDrawing, isArrowDrawing };
