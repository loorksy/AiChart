import type {
  EntityId,
  IChartWidgetApi,
  ShapePoint,
} from "@/vendor/tradingview/charting_library";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { Recommendation } from "@/lib/types";
import { normalizeTimestamp } from "@/lib/chart/chartTimeAnchor";
import { ticksPerPriceUnit } from "@/lib/chart/tv/tvSymbolTicks";
import { planTargetList } from "@/lib/chart/planTargets";
import { barDurationMs } from "@/lib/intervals";
import { createdAtMs } from "@/lib/recommendations/anchorTime";

/** Milliseconds → TradingView time (seconds). */
function toSec(ms: number): number {
  return Math.round(normalizeTimestamp(ms) / 1000);
}

function nowSec(): number {
  return Math.round(Date.now() / 1000);
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

/** Numbered target-line label (a single Arabic line, for the i18n ratchet). */
const targetLabel = (n: number): string => `هدف ${n}`;

/**
 * The profit edge of the position tool: the FURTHEST target on the trade's
 * own side — max for a long, min for a short (side-aware, so an unsorted
 * target list still yields the most distant TP). The user's rule: the box
 * must span the WHOLE plan; cutting it at TP1 hid where the trade ends.
 */
function furthestTarget(
  direction: "long" | "short",
  targets: number[],
): number | undefined {
  if (targets.length === 0) return undefined;
  return direction === "long" ? Math.max(...targets) : Math.min(...targets);
}

/** Recommendation creation time in TV seconds, or null when the payload
 *  carries no parseable `created_at`. */
function createdAtSec(rec: Recommendation): number | null {
  return parseTimeSec(rec.created_at);
}

/** Epoch ms/ISO/seconds → TradingView seconds, or null. */
function parseTimeSec(raw: unknown): number | null {
  const ms = createdAtMs(raw);
  return ms != null ? toSec(ms) : null;
}

/**
 * Print-time / activation-time anchor: the candle that tagged the entry,
 * persisted as `anchor_time` (or `triggeredAt` on some payloads). Preferred
 * over `created_at` so a leftover wait converted to immediate sits on the
 * historical print bar instead of hugging "now" at issue time.
 */
function printAnchorSec(rec: Recommendation): number | null {
  const extra = rec as Recommendation & { triggeredAt?: unknown; triggered_at?: unknown };
  return (
    parseTimeSec(rec.anchor_time) ??
    parseTimeSec(extra.triggeredAt) ??
    parseTimeSec(extra.triggered_at)
  );
}

/** Manages TradingView shapes for one chart — mirrors ChartDrawing[] onto it. */
export class TvDrawingManager {
  private ids: EntityId[] = [];
  private lastFingerprint = "";
  /**
   * Fallback anchors for recommendations that arrived WITHOUT `created_at`,
   * keyed by trade identity. Resolved once per trade and reused on every
   * later apply — recomputing "now" on each redraw was exactly the reported
   * slide: any payload change (poll hydration, MCP re-draw, forced re-apply)
   * rebuilt the profit/loss boxes hugging the latest candle. Deliberately
   * survives clear(): clear() runs before every redraw, and re-anchoring
   * there would be the bug all over again. Dies only with the widget.
   */
  private readonly fallbackAnchorSec = new Map<string, number>();

  constructor(private readonly chart: IChartWidgetApi) {}

  /**
   * Time anchor for the recommendation's risk/reward boxes: the printing
   * candle (`anchor_time` / `triggeredAt`) when a leftover wait was converted
   * to immediate, else the persisted creation time, else a bar-quantized
   * "now" resolved ONCE for this trade and cached, so new candles/ticks never
   * shift the zones. Pending plans have no print time and keep created_at.
   */
  private anchorSec(rec: Recommendation, barSec: number): number {
    const fromPrint = printAnchorSec(rec);
    if (fromPrint != null) return fromPrint;
    const fromCreatedAt = createdAtSec(rec);
    if (fromCreatedAt != null) return fromCreatedAt;
    const key = [rec.symbol ?? "", rec.action, rec.entry, rec.stop_loss, rec.take_profit].join("|");
    const cached = this.fallbackAnchorSec.get(key);
    if (cached != null) return cached;
    const step = Math.max(60, barSec);
    const now = nowSec();
    const anchor = now - (now % step);
    if (this.fallbackAnchorSec.size >= 16) this.fallbackAnchorSec.clear();
    this.fallbackAnchorSec.set(key, anchor);
    return anchor;
  }

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
    this.lastFingerprint = "";
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

  /**
   * TradingView's NATIVE Risk/Reward position tool for one trade plan —
   * green profit zone, red stop zone, entry line and R/R stats label exactly
   * as the standard TradingView tool renders them.
   *
   * Single-point creation, deliberately:
   * - `long_position`/`short_position` are single-point tools in this build
   *   (`CreateShapeOptions.shape`). Given only the entry anchor, the tool
   *   synthesizes its own body: entry bar + max(3, ~15% of the visible
   *   width) bars, INDEX-based — a fixed bar span that new candles simply
   *   fill under (`_getClosePointIndex` in line-tool-risk-reward).
   * - Supplying a second time anchor ourselves is what degenerated the old
   *   hand-drawn rectangles into the "thin expanding column": a time beyond
   *   the last bar has no bar to resolve to, so this build clamps it to the
   *   MOVING last bar (`indexOf(t, nearest)` returns the newest index for
   *   future times; the API conversion falls back to `closestIndexLeft`).
   *   The right edge therefore collapsed onto the live candle at draw time
   *   and crawled right with every new bar. No anchor may live in the
   *   future — the entry anchor is the recommendation's persisted
   *   created_at, a bar that exists by construction.
   * - `profitLevel`/`stopLevel` are TICKS from the entry. The library
   *   special-cases exactly these two override keys for the RiskReward
   *   tools and reconstructs prices as entry ± level × minmov/pricescale —
   *   the same symbol info the datafeed reports, shared via tvSymbolTicks.
   * - `text` must NOT be set: the tool generates its own stats label and
   *   the library THROWS ("Value is undefined") on caller-supplied text —
   *   a rejection `track()`'s catch would swallow silently, drawing nothing.
   */
  private position(
    direction: "long" | "short",
    entry: PricedPointLike,
    takeProfit: number,
    stopLoss: number,
    symbol: string,
  ): void {
    const base = ticksPerPriceUnit(symbol);
    const profitLevel = Math.round(Math.abs(takeProfit - entry.price) * base);
    const stopLevel = Math.round(Math.abs(stopLoss - entry.price) * base);
    // A zero-tick level renders a degenerate zone — skip the tool and let the
    // agent's entry/stop/target lines carry the information instead.
    if (profitLevel <= 0 || stopLevel <= 0) return;
    this.track(
      this.chart.createShape(
        { time: entry.time, price: entry.price } as ShapePoint,
        {
          shape: direction === "long" ? "long_position" : "short_position",
          ...EDITABLE,
          overrides: {
            profitLevel,
            stopLevel,
            linewidth: 1,
            fontsize: 11,
            profitBackground: "#22c55e",
            profitBackgroundTransparency: 82,
            stopBackground: "#ef4444",
            stopBackgroundTransparency: 82,
            showPriceLabels: true,
            compact: false,
          },
        },
      ),
    );
  }

  /**
   * The native tool spanning entry → the FURTHEST target, with every other
   * target kept visible as a numbered line inside the extended profit zone
   * (numbered by its original order in the plan, so TP1/TP2 read as issued).
   */
  private positionWithTargets(
    direction: "long" | "short",
    entry: PricedPointLike,
    targets: number[],
    stopLoss: number,
    symbol: string,
  ): void {
    const edge = furthestTarget(direction, targets);
    if (edge == null) return;
    this.position(direction, entry, edge, stopLoss, symbol);
    targets.forEach((price, i) => {
      // The edge is the tool's own profit line — a duplicate labeled line
      // would sit exactly on top of it.
      if (price === edge) return;
      this.hline(price, "#3b82f6", targetLabel(i + 1));
    });
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
      const direction = t === "long_position" ? "long" : "short";
      const entry = pts[0];
      const sl = (d.meta?.stopLoss as number) ?? pts[2]?.price;
      if (!entry || !sl) return;
      // A multi-target plan extends the tool to its furthest TP, same as the
      // recommendation path; a single-tp drawing keeps the plain contract.
      const metaTargets = Array.isArray(d.meta?.targets)
        ? (d.meta.targets as unknown[]).filter(
            (x): x is number => typeof x === "number" && x > 0,
          )
        : [];
      if (metaTargets.length > 0) {
        this.positionWithTargets(direction, entry, metaTargets, sl, symbol);
      } else {
        const tp = (d.meta?.takeProfit as number) ?? pts[1]?.price;
        if (tp) this.position(direction, entry, tp, sl, symbol);
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
        // Project the line to the current bar — a structural trendline that
        // dies at its second pivot reads as history, not as a live level.
        extendRight: true,
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
    opts?: { force?: boolean },
  ): void {
    const rec0 = trade?.recommendation;
    // Idempotence guard: the layout poll and unrelated re-renders re-deliver the
    // same payload every few seconds. Destroying and re-creating every shape for
    // an unchanged payload is what made agent drawings flicker and the position
    // tool jump — and it also snapped back any in-progress user adjustment.
    const fingerprint = JSON.stringify([
      drawings,
      rec0
        ? [rec0.action, rec0.entry, rec0.stop_loss, rec0.take_profit, rec0.created_at, rec0.anchor_time]
        : null,
      planTargetList({
        targets: trade?.targets,
        takeProfit: rec0?.take_profit,
        targetsJson: rec0?.targets_json,
      }),
      rec0 && Array.isArray(rec0.targets) ? rec0.targets : [],
      ctx?.symbol ?? "",
      ctx?.interval ?? "",
    ]);
    if (!opts?.force && fingerprint === this.lastFingerprint) return;
    this.clear();
    this.lastFingerprint = fingerprint;
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
      const tps = planTargetList({
        targets:
          trade?.targets && trade.targets.length > 0 ? trade.targets : rec.targets,
        takeProfit: rec.take_profit,
        targetsJson: rec.targets_json,
      });
      const entry = rec.entry;
      const sl = rec.stop_loss;
      if (entry != null && entry > 0 && sl != null && sl > 0 && tps.length > 0) {
        // Native TV position tool: entry/target/stop with automatic R/R stats.
        // Anchored at the printing candle when `anchor_time` is present (a
        // leftover wait converted to immediate), else the persisted creation
        // time (sticky bar-quantized fallback for legacy payloads without one)
        // so re-applies reproduce the exact same shape instead of drifting to
        // wall-clock "now" on every redraw. The profit zone reaches the
        // FURTHEST target; the nearer TPs render as numbered lines inside it.
        this.positionWithTargets(
          rec.action === "buy" ? "long" : "short",
          { time: this.anchorSec(rec, barSec), price: entry },
          tps,
          sl,
          rec.symbol || symbol,
        );
      } else {
        // Partial setups fall back to labeled horizontal lines.
        if (entry != null && entry > 0) this.hline(entry, "#22c55e", "دخول");
        if (sl != null && sl > 0) this.hline(sl, "#ef4444", "وقف خسارة", true);
        tps.forEach((price, i) => {
          this.hline(price, "#3b82f6", tps.length > 1 ? targetLabel(i + 1) : "هدف ربح");
        });
      }
    }
  }
}
