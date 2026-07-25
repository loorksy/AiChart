import type {
  EntityId,
  IChartWidgetApi,
  ShapePoint,
} from "@/vendor/tradingview/charting_library";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { Recommendation } from "@/lib/types";
import { normalizeTimestamp } from "@/lib/chart/chartTimeAnchor";
import { barDurationMs } from "@/lib/intervals";

/** Milliseconds → TradingView time (seconds). */
function toSec(ms: number): number {
  return Math.round(normalizeTimestamp(ms) / 1000);
}

function nowSec(): number {
  return Math.round(Date.now() / 1000);
}

/** Same tick heuristic as the datafeed's pricescale. */
function minTickFor(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("JPY")) return 0.001;
  if (s.includes("XAU") || s.includes("XAG")) return 0.01;
  return 0.00001;
}

type PricedPointLike = { time: number; price: number };

function pointsOf(d: ChartDrawing, barSec: number): PricedPointLike[] {
  const now = nowSec();
  return (d.points ?? [])
    .filter((p) => typeof p.price === "number" && p.price > 0)
    .map((p) => ({
      time:
        p.time && p.time > 0
          ? toSec(p.time)
          : p.barsAhead != null
            ? now + Math.round(p.barsAhead) * barSec
            : now,
      price: p.price,
    }));
}

const LINE_STYLE: Record<string, number> = { solid: 0, dotted: 1, dashed: 2 };

const SINGLE_HLINE = new Set<string>(["price_line", "hline", "baseline", "marker"]);
const RECT_TYPES = new Set<string>([
  "zone",
  "range_box",
  "supply_zone",
  "demand_zone",
  "decision_zone",
  "retest_zone",
  "histogram_band",
  "rectangle",
]);
const TREND_TYPES = new Set<string>([
  "trend_line",
  "trend",
  "trendline",
  "neckline",
  "gann_line",
  "pitchfork",
]);
const FIB_TYPES = new Set<string>([
  "fib_retracement",
  "fibo",
  "fibonacci",
  "expansion",
  "fibo_fan",
  "fibo_arc",
]);
const ARROW_UP = new Set<string>(["arrow_up", "arrow_buy", "breakout_arrow"]);
const ARROW_DOWN = new Set<string>(["arrow_down", "arrow_sell"]);
const TEXT_TYPES = new Set<string>(["text", "label", "pattern_label"]);

/** patternType → dedicated TradingView pattern tool (when point count fits). */
const PATTERN_TOOL: Record<string, { tool: string; pts: number }> = {
  head_and_shoulders: { tool: "head_and_shoulders", pts: 7 },
  inverse_head_and_shoulders: { tool: "head_and_shoulders", pts: 7 },
  ascending_triangle: { tool: "triangle_pattern", pts: 4 },
  descending_triangle: { tool: "triangle_pattern", pts: 4 },
  symmetrical_triangle: { tool: "triangle_pattern", pts: 4 },
  w_pattern: { tool: "xabcd_pattern", pts: 5 },
  m_pattern: { tool: "xabcd_pattern", pts: 5 },
  double_bottom: { tool: "xabcd_pattern", pts: 5 },
  double_top: { tool: "xabcd_pattern", pts: 5 },
  // Geometry-engine shapes: wedges reuse the triangle tool (same 4-anchor
  // boundary construction); flags/pennants/cup render as an explicit labeled
  // polyline — better than the silent generic fallback they previously hit.
  wedge: { tool: "triangle_pattern", pts: 4 },
  flag: { tool: "polyline", pts: 3 },
  pennant: { tool: "polyline", pts: 3 },
  cup_and_handle: { tool: "polyline", pts: 5 },
};

// Real, user-editable chart drawings: selectable, draggable, adjustable
// (e.g. widen a channel or move the SL of a position) and listed in the
// objects tree — exactly like manually-drawn TradingView tools.
const EDITABLE = {
  lock: false,
  disableSelection: false,
  disableSave: true,
  disableUndo: false,
  showInObjectsTree: true,
} as const;

/**
 * Generic style overrides honoring the AI's choices: color, width (1–4),
 * style (solid/dashed/dotted), fill + fill_color. Keys cover the common
 * TV line-tool override names so each tool picks up what it supports.
 */
function styleOverrides(d: ChartDrawing): Record<string, unknown> {
  const color = d.color ?? d.fill_color ?? "#94a3b8";
  const width = Math.min(4, Math.max(1, Math.round(d.width ?? 2)));
  const lineStyle =
    LINE_STYLE[d.style ?? ""] ?? (d.type === "forecast_path" ? 2 : 0);
  const fillColor = d.fill_color ?? color;
  return {
    linecolor: color,
    color,
    linewidth: width,
    linestyle: lineStyle,
    backgroundColor: fillColor,
    fillBackground: d.fill !== false,
    transparency: d.fill ? 78 : 88,
    textcolor: color,
    fontsize: d.font_size ?? 11,
    bold: false,
  };
}

/** Manages TradingView shapes for one chart — mirrors ChartDrawing[] onto it. */
export class TvDrawingManager {
  private ids: EntityId[] = [];

  constructor(private readonly chart: IChartWidgetApi) {}

  /** Entity ids this manager owns (agent + recommendation shapes). Everything
   *  else on the chart is a user-drawn shape. */
  trackedIds(): EntityId[] {
    return [...this.ids];
  }

  clear(): void {
    for (const id of this.ids) {
      try {
        this.chart.removeEntity(id);
      } catch {
        /* already gone */
      }
    }
    this.ids = [];
  }

  private track(p: Promise<EntityId>): void {
    void p.then((id) => this.ids.push(id)).catch(() => {});
  }

  private hline(
    price: number,
    color: string,
    label: string,
    dashed = false,
    width = 2,
  ): void {
    this.track(
      this.chart.createShape(
        { time: nowSec(), price } as ShapePoint,
        {
          shape: "horizontal_line",
          text: label,
          ...EDITABLE,
          overrides: {
            linecolor: color,
            linewidth: width,
            linestyle: dashed ? 2 : 0,
            showLabel: Boolean(label),
            textcolor: color,
            horzLabelsAlign: "left",
            vertLabelsAlign: "top",
            fontsize: 11,
          },
        },
      ),
    );
  }

  private multi(
    points: PricedPointLike[],
    shape: string,
    overrides: Record<string, unknown>,
    text?: string,
  ): void {
    if (points.length < 2) return;
    this.track(
      this.chart.createMultipointShape(points as ShapePoint[], {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shape: shape as any,
        ...(text ? { text } : {}),
        ...EDITABLE,
        overrides,
      }),
    );
  }

  private one(
    point: PricedPointLike,
    shape: string,
    text: string,
    overrides: Record<string, unknown>,
  ): void {
    this.track(
      this.chart.createShape(point as ShapePoint, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shape: shape as any,
        text,
        ...EDITABLE,
        overrides,
      }),
    );
  }

  /** TV long/short position tool: entry point + profit/stop levels in ticks. */
  private position(
    kind: "long_position" | "short_position",
    entry: PricedPointLike,
    takeProfit: number,
    stopLoss: number,
    minTick: number,
  ): void {
    const profitLevel = Math.max(1, Math.round(Math.abs(takeProfit - entry.price) / minTick));
    const stopLevel = Math.max(1, Math.round(Math.abs(entry.price - stopLoss) / minTick));
    this.track(
      this.chart.createShape(entry as ShapePoint, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shape: kind as any,
        ...EDITABLE,
        overrides: { profitLevel, stopLevel },
      }),
    );
  }

  private drawOne(d: ChartDrawing, symbol: string, barSec: number): void {
    const ov = styleOverrides(d);
    const color = String(ov.linecolor);
    const dashed = d.style === "dashed" || d.style === "dotted" || d.type === "forecast_path";
    const label = d.label ?? "";
    const pts = pointsOf(d, barSec);
    const t = d.type;

    // AI-drawn buy/sell positions (entry/tp/sl via meta or 2–3 points).
    if (t === "long_position" || t === "short_position") {
      const entry = pts[0];
      const tp = (d.meta?.takeProfit as number) ?? pts[1]?.price;
      const sl = (d.meta?.stopLoss as number) ?? pts[2]?.price;
      if (entry && tp && sl) {
        this.position(t, entry, tp, sl, minTickFor(symbol));
      }
      return;
    }
    if (SINGLE_HLINE.has(t)) {
      const price = pts[0]?.price ?? d.price;
      if (typeof price === "number" && price > 0)
        this.hline(price, color, label, dashed, Number(ov.linewidth));
      return;
    }
    if (RECT_TYPES.has(t)) {
      this.multi(pts.slice(0, 2), "rectangle", ov, label);
      return;
    }
    if (FIB_TYPES.has(t)) {
      this.multi(pts.slice(0, 2), "fib_retracement", {
        linecolor: color,
        linewidth: ov.linewidth,
      });
      return;
    }
    if (t === "triangle") {
      this.multi(pts.slice(0, 3), "triangle", ov, label);
      return;
    }
    if (t === "channel" || t === "parallel_channel") {
      if (pts.length >= 3) {
        // 3 points give the channel its slope/direction exactly as analyzed.
        this.multi(pts.slice(0, 3), "parallel_channel", ov, label);
      } else {
        this.multi(pts.slice(0, 2), "trend_line", ov, label);
      }
      return;
    }
    if (t === "regression_trend") {
      this.multi(pts.slice(0, 2), "regression_trend", ov);
      return;
    }
    if (t === "forecast_path") {
      // Native TV forecast projection from last anchor into the future,
      // plus a dashed path when the AI supplied a multi-point trajectory.
      if (pts.length > 2) {
        this.multi(pts.slice(0, 8), "path", { ...ov, linestyle: 2 }, label);
      } else if (pts.length === 2) {
        this.multi(pts, "forecast", ov);
      }
      return;
    }
    if (t === "polyline_pattern") {
      const pat = d.patternType ? PATTERN_TOOL[d.patternType] : undefined;
      if (pat && pts.length >= pat.pts) {
        this.multi(pts.slice(0, pat.pts), pat.tool, ov, label);
      } else {
        this.multi(pts.slice(0, 8), "polyline", ov, label);
      }
      return;
    }
    if (t === "labeled_arrow" || t === "arrow") {
      this.multi(pts.slice(0, 2), "arrow", ov, label);
      return;
    }
    if (ARROW_UP.has(t)) {
      if (pts[0]) this.one(pts[0], "arrow_up", label, { color });
      return;
    }
    if (ARROW_DOWN.has(t)) {
      if (pts[0]) this.one(pts[0], "arrow_down", label, { color });
      return;
    }
    if (TEXT_TYPES.has(t)) {
      if (pts[0]) {
        this.one(pts[0], "text", label, {
          color,
          fontsize: d.font_size ?? 12,
          backgroundColor: "rgba(10,14,23,0.66)",
          drawBorder: false,
        });
      }
      return;
    }
    if (TREND_TYPES.has(t)) {
      this.multi(pts.slice(0, 2), "trend_line", {
        ...ov,
        showLabel: Boolean(label),
      }, label);
      return;
    }
    if (t === "risk_reward_box") {
      this.multi(pts.slice(0, 2), "rectangle", ov, label);
      return;
    }
    if (t === "ray") {
      this.multi(pts.slice(0, 2), "ray", ov);
      return;
    }
    if (t === "vline") {
      if (pts[0]) this.one(pts[0], "vertical_line", label, ov);
      return;
    }
    // Fallback: two-point trend line, or a horizontal line for a lone price.
    if (pts.length >= 2) {
      this.multi(pts.slice(0, 2), "trend_line", ov, label);
    } else if (pts[0]) {
      this.hline(pts[0].price, color, label, dashed);
    }
  }

  /** Redraw all AI drawings + the trade position for the active recommendation. */
  apply(
    drawings: ChartDrawing[],
    trade?: { recommendation?: Recommendation | null; targets?: number[] },
    ctx?: { symbol?: string; interval?: string },
  ): void {
    this.clear();
    const symbol = ctx?.symbol ?? "";
    const barSec = Math.max(
      60,
      Math.round((barDurationMs(ctx?.interval ?? "15m") || 900_000) / 1000),
    );
    for (const d of drawings) {
      try {
        this.drawOne(d, symbol, barSec);
      } catch {
        /* skip un-renderable drawing */
      }
    }
    const rec = trade?.recommendation;
    if (rec && (rec.action === "buy" || rec.action === "sell")) {
      const tps =
        trade?.targets && trade.targets.length > 0
          ? trade.targets.filter((x) => x > 0)
          : rec.take_profit != null && rec.take_profit > 0
            ? [rec.take_profit]
            : [];
      const entry = rec.entry;
      const sl = rec.stop_loss;
      const tp1 = tps[0];
      if (entry != null && entry > 0 && sl != null && sl > 0 && tp1 != null) {
        // Native TV position tool: entry/target/stop with automatic R/R stats.
        this.position(
          rec.action === "buy" ? "long_position" : "short_position",
          { time: nowSec(), price: entry },
          tp1,
          sl,
          minTickFor(symbol),
        );
        // Extra targets beyond TP1 as labeled blue lines.
        tps.slice(1).forEach((price, i) => {
          this.hline(price, "#3b82f6", `هدف ${i + 2}`);
        });
      } else {
        // Partial setups fall back to labeled horizontal lines.
        if (entry != null && entry > 0) this.hline(entry, "#22c55e", "دخول");
        if (sl != null && sl > 0) this.hline(sl, "#ef4444", "وقف خسارة", true);
        tps.forEach((price, i) => {
          this.hline(price, "#3b82f6", tps.length > 1 ? `هدف ${i + 1}` : "هدف ربح");
        });
      }
    }
  }
}
