import type { LineWidth, LineStyle } from "lightweight-charts";
import { barDurationSec } from "./intervals";
import type { AnalysisProfile } from "./analysisProfile";

export type DrawingType =
  | "price_line"
  | "trend_line"
  | "forecast_path"
  | "channel"
  | "zone"
  | "fib_retracement"
  | "baseline"
  | "marker"
  | "histogram_band";

export interface ChartPoint {
  barsAhead: number;
  price: number;
  time?: number;
}

export interface ChartDrawing {
  type: DrawingType;
  confidence: number;
  label?: string;
  color?: string;
  points: ChartPoint[];
  meta?: Record<string, unknown>;
}

export interface DrawingStyle {
  lineWidth: LineWidth;
  lineStyle: LineStyle;
  color: string;
  opacity: number;
}

const DEFAULT_COLORS: Record<DrawingType, string> = {
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

export function styleForConfidence(conf: number, type: DrawingType): DrawingStyle {
  const base = DEFAULT_COLORS[type] ?? "#94a3b8";
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

export function parseChartDrawingsJson(raw: string | null | undefined): ChartDrawing[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is ChartDrawing =>
        typeof d === "object" &&
        d != null &&
        typeof (d as ChartDrawing).type === "string" &&
        Array.isArray((d as ChartDrawing).points),
    );
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
      if (d.points.length < profile.forecastBarsMin) continue;
      if (isFlatPath(d.points)) continue;
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
        lastBarTimeSec + p.barsAhead * step) as number,
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
    for (const p of d.points) prices.push(p.price);
  }
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
