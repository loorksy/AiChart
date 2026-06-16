import type { LineWidth, LineStyle } from "lightweight-charts";
import { barDurationSec } from "./intervals";
import type { AnalysisProfile } from "./analysisProfile";

/** Semantic types used by the agent + optional MT5-native types for advanced EA drawing. */
export type SemanticDrawingType =
  | "price_line"
  | "trend_line"
  | "forecast_path"
  | "channel"
  | "zone"
  | "fib_retracement"
  | "baseline"
  | "marker"
  | "histogram_band";

export type Mt5NativeDrawingType =
  | "hline"
  | "vline"
  | "trend"
  | "trendline"
  | "ray"
  | "rectangle"
  | "triangle"
  | "ellipse"
  | "arrow_down"
  | "arrow_sell"
  | "arrow_up"
  | "arrow_buy"
  | "arrow_stop"
  | "arrow_check"
  | "arrow_thumb_up"
  | "arrow_thumb_down"
  | "arrow"
  | "fibo"
  | "fibonacci"
  | "fibo_fan"
  | "fibo_arc"
  | "expansion"
  | "pitchfork"
  | "gann_line"
  | "gann_fan"
  | "text"
  | "label";

export type DrawingType = SemanticDrawingType | Mt5NativeDrawingType;

export interface ChartPoint {
  barsAhead: number;
  /** Alias for EA flat format */
  time_offset?: number;
  price: number;
  time?: number;
}

export interface ChartDrawing {
  type: DrawingType;
  confidence: number;
  label?: string;
  color?: string;
  points: ChartPoint[];
  /** Optional flat coords (EA v3.07+) — used when points[] is empty */
  price?: number;
  price2?: number;
  price3?: number;
  time_offset?: number;
  time_offset2?: number;
  time_offset3?: number;
  width?: number;
  style?: "solid" | "dashed" | "dotted";
  fill?: boolean;
  fill_color?: string;
  font_size?: number;
  arrow_code?: number;
  x?: number;
  y?: number;
  meta?: Record<string, unknown>;
}

export interface DrawingStyle {
  lineWidth: LineWidth;
  lineStyle: LineStyle;
  color: string;
  opacity: number;
}

const SEMANTIC_DEFAULT_COLORS: Record<SemanticDrawingType, string> = {
  price_line: "#22c55e",
  trend_line: "#a78bfa",
  forecast_path: "#f59e0b",
  channel: "#38bdf8",
  zone: "#6366f1",
  fib_retracement: "#ec4899",
  baseline: "#14b8a6",
  marker: "#eab308",
  histogram_band: "#f97316",
};

const SEMANTIC_TYPES = new Set<string>([
  "price_line",
  "trend_line",
  "forecast_path",
  "channel",
  "zone",
  "fib_retracement",
  "baseline",
  "marker",
  "histogram_band",
]);

export function styleForConfidence(conf: number, type: DrawingType): DrawingStyle {
  const base =
    (SEMANTIC_TYPES.has(type)
      ? SEMANTIC_DEFAULT_COLORS[type as SemanticDrawingType]
      : undefined) ?? "#94a3b8";
  if (conf >= 85) {
    return { lineWidth: 3, lineStyle: 0, color: base, opacity: 1 };
  }
  if (conf >= 70) {
    return { lineWidth: 2, lineStyle: 0, color: base, opacity: 0.95 };
  }
  if (conf >= 55) {
    return { lineWidth: 2, lineStyle: 2, color: base, opacity: 0.75 };
  }
  return { lineWidth: 1, lineStyle: 1, color: base, opacity: 0.45 };
}

function isChartDrawing(d: unknown): d is ChartDrawing {
  if (typeof d !== "object" || d == null) return false;
  const o = d as ChartDrawing;
  if (typeof o.type !== "string") return false;
  if (Array.isArray(o.points)) return true;
  return typeof o.price === "number" && o.price > 0;
}

export function parseChartDrawingsJson(raw: string | null | undefined): ChartDrawing[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChartDrawing).map((d) => ({
      ...d,
      points: d.points ?? [],
    }));
  } catch {
    return [];
  }
}

function isFlatPath(points: ChartPoint[]): boolean {
  if (points.length < 3) return true;
  let flatSegments = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.price;
    const cur = points[i]!.price;
    if (prev > 0 && Math.abs((cur - prev) / prev) < 0.003) flatSegments++;
  }
  return flatSegments >= points.length - 2;
}

export function validateChartDrawings(
  drawings: ChartDrawing[],
  action: string,
  confidence: number,
  profile: AnalysisProfile,
): ChartDrawing[] {
  const out: ChartDrawing[] = [];
  for (const d of drawings) {
    const conf = Math.min(100, Math.max(0, d.confidence ?? 0));
    if (d.type === "forecast_path") {
      if (confidence < 55 || action === "wait") continue;
    const pts = d.points ?? [];
      if (pts.length < profile.forecastBarsMin) continue;
      if (isFlatPath(pts)) continue;
    }
    if (d.type === "channel" && confidence < 75) continue;
    if (d.type === "fib_retracement" && confidence < 80) continue;
    out.push({ ...d, confidence: conf });
  }
  return out;
}

/** Map forecast points to unix timestamps from last candle time. */
export function pointsToLineData(
  points: ChartPoint[],
  lastBarTimeSec: number,
  interval: string,
): { time: number; value: number }[] {
  const step = barDurationSec(interval);
  return points
    .map((p) => ({
      time: (p.time ??
        lastBarTimeSec + (p.barsAhead ?? p.time_offset ?? 0) * step) as number,
      value: p.price,
    }))
    .sort((a, b) => a.time - b.time);
}

export function drawingPriceBounds(drawings: ChartDrawing[]): {
  min: number;
  max: number;
} | null {
  const prices: number[] = [];
  for (const d of drawings) {
    for (const p of d.points ?? []) prices.push(p.price);
    if (d.price != null) prices.push(d.price);
    if (d.price2 != null) prices.push(d.price2);
    if (d.price3 != null) prices.push(d.price3);
  }
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
