import type { AnalysisProfile } from "./analysisProfile";

/** Semantic types used by the agent for chart drawing. */
export type SemanticDrawingType =
  | "price_line"
  | "trend_line"
  | "forecast_path"
  | "channel"
  | "zone"
  | "fib_retracement"
  | "baseline"
  | "marker"
  | "histogram_band"
  | "polyline_pattern"
  | "risk_reward_box"
  | "neckline"
  | "breakout_arrow"
  | "retest_zone"
  | "pattern_label"
  | "range_box"
  | "supply_zone"
  | "demand_zone"
  | "decision_zone"
  | "labeled_arrow"
  | "long_position"
  | "short_position"
  | "parallel_channel"
  | "regression_trend";

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

export type SemanticRole =
  | "support"
  | "resistance"
  | "demand_zone"
  | "supply_zone"
  | "range"
  | "trendline"
  | "channel"
  | "neckline"
  | "breakout"
  | "retest"
  | "entry"
  | "stop_loss"
  | "take_profit"
  | "risk_reward"
  | "pattern"
  | "forecast"
  | "liquidity_sweep"
  | "decision_zone";

export type PatternTypeName =
  | "double_bottom"
  | "double_top"
  | "w_pattern"
  | "m_pattern"
  | "head_and_shoulders"
  | "inverse_head_and_shoulders"
  | "ascending_triangle"
  | "descending_triangle"
  | "symmetrical_triangle"
  | "cup_and_handle"
  | "inverse_cup_and_handle"
  | "rectangle"
  | "triple_top"
  | "triple_bottom"
  | "flag"
  | "pennant"
  | "wedge"
  | "channel"
  | "range";

export interface ChartPoint {
  price: number;
  /** Unix timestamp (sec or ms) — PRIMARY anchor for historical points. */
  time?: number;
  /** ONLY for forecast_path future points. */
  barsAhead?: number;
  /** @deprecated use time */
  time_offset?: number;
}

export interface DrawingScope {
  symbol: string;
  market: string;
  anchorMode: "time_price";
}

export interface ChartDrawing {
  type: DrawingType;
  confidence: number;
  label?: string;
  color?: string;
  points: ChartPoint[];
  anchorMode?: "time_price";
  semanticRole?: SemanticRole;
  patternType?: PatternTypeName;
  drawingPurpose?: string;
  /** Optional flat coords — used when points[] is empty */
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
  /** UI-only — never used for chart technical drawings */
  x?: number;
  y?: number;
  meta?: Record<string, unknown> & {
    drawing_scope?: DrawingScope;
    sourceTimeframe?: string;
    riskReward?: number;
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
}

const ZONE_TYPES = new Set<string>([
  "zone",
  "range_box",
  "supply_zone",
  "demand_zone",
  "decision_zone",
  "retest_zone",
  "histogram_band",
  "rectangle",
]);

const ARROW_TYPES = new Set<string>([
  "breakout_arrow",
  "labeled_arrow",
  "arrow",
  "arrow_up",
  "arrow_down",
  "arrow_buy",
  "arrow_sell",
]);

export function isZoneDrawing(type: string): boolean {
  return ZONE_TYPES.has(type);
}

export function isArrowDrawing(type: string): boolean {
  return ARROW_TYPES.has(type);
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
    if (d.type === "risk_reward_box" && action === "wait") continue;
    if (d.type === "channel" && confidence < 75) continue;
    if (d.type === "fib_retracement" && confidence < 80) continue;
    out.push({ ...d, confidence: conf });
  }
  return out;
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
