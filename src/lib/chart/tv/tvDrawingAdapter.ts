import type {
  EntityId,
  IChartWidgetApi,
  ShapePoint,
} from "@/vendor/tradingview/charting_library";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { Recommendation } from "@/lib/types";
import { normalizeTimestamp } from "@/lib/chart/chartTimeAnchor";
import { planTargetList } from "@/lib/chart/planTargets";
import { priceDistanceTicks } from "@/lib/chart/tv/tvSymbolTicks";
import { barDurationMs } from "@/lib/intervals";
import { createdAtMs } from "@/lib/recommendations/anchorTime";

/** Milliseconds → TradingView time (seconds). */
function toSec(ms: number): number {
  return Math.round(normalizeTimestamp(ms) / 1000);
}

function nowSec(): number {
  return Math.round(Date.now() / 1000);
}

/**
 * Real post-2001 unix seconds. Rejects 0, epoch-1970, and bar-index lookalikes
 * that TradingView would clamp to the FIRST loaded bar — that clamp is what
 * painted the P/L fill as a full-width band across the whole visible pane.
 */
export const MIN_PLAUSIBLE_UNIX_SEC = 1_000_000_000;

export function isPlausibleUnixSec(
  t: number,
  now: number = nowSec(),
): boolean {
  return Number.isFinite(t) && t >= MIN_PLAUSIBLE_UNIX_SEC && t < now + 86_400;
}

/**
 * Finite time-bounded P/L box. Left is the print/anchor second when it is a
 * real chart time; missing/zero/epoch falls back to lastBar (a thin column at
 * the live candle) — never t=0. Right is lastBar already in history. No
 * future Close (that clamp-and-slide walked the left edge). Returns null
 * until the box has positive width (right > left) with both times finite.
 */
export function positionBoxEdges(input: {
  leftSec: number | null | undefined;
  lastBarSec: number | null | undefined;
  nowSec?: number;
}): { left: number; right: number } | null {
  const now = input.nowSec ?? nowSec();
  const last = input.lastBarSec;
  if (last == null || !isPlausibleUnixSec(last, now)) return null;
  const left =
    input.leftSec != null && isPlausibleUnixSec(input.leftSec, now)
      ? input.leftSec
      : last;
  if (left > last) return null;
  if (!(last > left)) return null;
  return { left, right: last };
}

/**
 * Entry + Close of the native Long/Short Position tool. Both points sit on
 * the entry price; width is the time span (print/anchor → lastBar). Never a
 * future Close, never t=0 — those clamps painted the full-width band.
 */
export function positionToolPoints(
  left: number,
  right: number,
  entryPrice: number,
): Array<{ time: number; price: number }> {
  return [
    { time: Math.round(left), price: entryPrice },
    { time: Math.round(right), price: entryPrice },
  ];
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
 *  carries no parseable `created_at` (or the parsed value is epoch/junk). */
function createdAtSec(rec: Recommendation): number | null {
  return parseTimeSec(rec.created_at);
}

/** Epoch ms/ISO/seconds → TradingView seconds, or null. */
function parseTimeSec(raw: unknown): number | null {
  const ms = createdAtMs(raw);
  if (ms == null) return null;
  const sec = toSec(ms);
  return isPlausibleUnixSec(sec) ? sec : null;
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

/**
 * Chart-payload statuses that mean the plan is finished. Visual width freezes
 * here — tracking (`evaluateRecommendation`) is what actually grades TP/SL,
 * and it never reads this drawing's bar span.
 */
const TERMINAL_CHART_STATUS = new Set<string>([
  "tp_hit",
  "tp1_hit",
  "tp2_hit",
  "tp3_hit",
  "sl_hit",
  "expired",
  "cancelled",
  "invalidated",
  "closed",
]);

function isTerminalChartRecommendation(
  rec: Recommendation | null | undefined,
): boolean {
  if (!rec) return false;
  if (rec.status && TERMINAL_CHART_STATUS.has(rec.status)) return true;
  const extra = rec as Recommendation & { outcome?: unknown };
  return typeof extra.outcome === "string" && extra.outcome !== "" && extra.outcome !== "pending";
}

function tradeKeyOf(rec: Recommendation | null | undefined): string {
  if (!rec) return "";
  return [
    rec.symbol ?? "",
    rec.action,
    rec.entry,
    rec.stop_loss,
    rec.take_profit,
    rec.created_at,
    rec.anchor_time,
  ].join("|");
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
  /**
   * Bumps on every clear() so a createShape that resolves after a later
   * redraw cannot stretch a removed entity (or the next trade's shape).
   */
  private applyGen = 0;
  /** The one native Long/Short Position entity (risk + profit joined at entry). */
  private positionId: EntityId | null = null;
  /** Guards against apply()+syncRightEdge both creating before promises resolve. */
  private boxCreateStarted = false;
  private pendingBox: {
    direction: "long" | "short";
    entry: PricedPointLike;
    takeProfit: number;
    stopLoss: number;
    symbol: string;
  } | null = null;
  /** Sticky left edge (print/anchor), unix seconds. Never rewritten to lastBar. */
  private positionLeftSec: number | null = null;
  /** Last Close time we wrote via setPoints (unix seconds). */
  private lastRightSec: number | null = null;
  /** Close time frozen when the plan became terminal — restored on recreate. */
  private frozenRightSec: number | null = null;
  private positionFrozen = false;
  private pendingTerminal = false;
  private lastTradeKey = "";
  /** Latest in-history bar, unix seconds. Never a future time. */
  private liveLastBarSec: number | null = null;

  constructor(private readonly chart: IChartWidgetApi) {}

  /**
   * Time anchor for the recommendation's risk/reward box: the printing
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
    // Prefer lastBar (in history) over wall-clock "now" — now can sit slightly
    // past the last bar, which would refuse the box until a candle that never
    // comes. lastBar is also what keeps a missing/zero anchor off t=0.
    const step = Math.max(60, barSec);
    const now = nowSec();
    const seed =
      this.liveLastBarSec != null && isPlausibleUnixSec(this.liveLastBarSec)
        ? this.liveLastBarSec
        : now - (now % step);
    const anchor = isPlausibleUnixSec(seed) ? seed : null;
    if (anchor == null) return now;
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
    this.applyGen += 1;
    for (const id of this.ids) {
      try {
        this.chart.removeEntity(id);
      } catch {
        /* already gone */
      }
    }
    this.ids = [];
    this.lastFingerprint = "";
    this.positionId = null;
    this.boxCreateStarted = false;
    this.pendingBox = null;
    // Keep positionLeftSec / freeze / lastBar: a recreate of the SAME trade
    // must restore the frozen right edge rather than jump.
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
   * One native Long/Short Position (risk-reward) tool for the trade plan.
   *
   * History that failed on this widget (do not revive):
   * 1. `createShape` with ONE point → the library synthesizes Close from the
   *    visible pane → a full-width horizontal price band.
   * 2. Two-point `rectangle` → this build ignores X when times are equal,
   *    missing, or extend flags leak → still a strip.
   * 3. Two closed 5-vertex `polyline`s (`8b6705e1`) → polyline has no
   *    extendLeft/Right properties, create can drop vertex times, and a
   *    filled path with missing/equal times paints pane-wide. Two independent
   *    fills also failed the product rule: profit and risk must be the SAME
   *    drawing, joined at entry, not two boxes on the pane.
   *
   * What sticks time: TWO points on `createMultipointShape` — Entry
   * `{time: leftSec, price: entry}` and Close `{time: rightSec, price: entry}`
   * (unix seconds, right > left, never a future Close — that clamp SLIDES
   * the left edge). After create, always `setPoints` both corners AND set
   * `stopLevel` / `profitLevel` (furthest TP, in ticks) / `extendLeft: false`
   * / `extendRight: false`. Pin even if lastBar did not move during the
   * create promise — create alone is not enough on this widget.
   *
   * - Left = print/anchor candle (`anchor_time` / `triggeredAt`, else
   *   created_at, else a sticky lastBar fallback — never t=0).
   * - Right = last historical bar while live; frozen on terminal.
   * - Intermediate TPs stay labeled hlines inside the one box.
   * - Horizontal growth is VISUAL ONLY. Tracking never reads this width.
   */
  private position(
    direction: "long" | "short",
    entry: PricedPointLike,
    takeProfit: number,
    stopLoss: number,
    symbol: string,
  ): void {
    if (!(entry.price > 0) || !(takeProfit > 0) || !(stopLoss > 0)) return;
    if (takeProfit === entry.price || stopLoss === entry.price) return;
    this.pendingBox = { direction, entry, takeProfit, stopLoss, symbol };
    this.tryCreatePositionBox();
  }

  private positionOverrides(pending: {
    symbol: string;
    entry: PricedPointLike;
    takeProfit: number;
    stopLoss: number;
  }): Record<string, unknown> {
    return {
      stopLevel: priceDistanceTicks(pending.symbol, pending.entry.price, pending.stopLoss),
      profitLevel: priceDistanceTicks(pending.symbol, pending.entry.price, pending.takeProfit),
      extendLeft: false,
      extendRight: false,
      fillBackground: true,
      profitBackground: "rgba(34, 197, 94, 0.2)",
      stopBackground: "rgba(239, 68, 68, 0.2)",
    };
  }

  /**
   * Create the one native position tool once lastBar is known and the box has
   * positive width. Called from apply() and again from syncRightEdge when
   * the first in-history bar arrives after a rec that landed first.
   */
  private tryCreatePositionBox(): void {
    const pending = this.pendingBox;
    if (!pending) return;
    if (this.positionId != null) return;
    if (this.boxCreateStarted) return;
    const rightSrc =
      this.positionFrozen && this.frozenRightSec != null
        ? this.frozenRightSec
        : this.liveLastBarSec;
    const edges = positionBoxEdges({
      leftSec: this.positionLeftSec ?? pending.entry.time,
      lastBarSec: rightSrc,
    });
    if (!edges) return;
    this.boxCreateStarted = true;
    this.positionLeftSec = edges.left;
    this.lastRightSec = edges.right;
    const gen = this.applyGen;
    // Two-point create — never createShape(one point). Single-point create
    // is what painted the full-width band (Close synthesized from pane width).
    // Do not set `text`: the library throws on long/short_position text.
    const created = this.chart.createMultipointShape(
      positionToolPoints(edges.left, edges.right, pending.entry.price) as ShapePoint[],
      {
        shape: pending.direction === "long" ? "long_position" : "short_position",
        ...EDITABLE,
        overrides: this.positionOverrides(pending),
      },
    );
    this.track(created);
    if (this.pendingTerminal && !this.positionFrozen) this.freezePosition();
    void created
      .then((id) => {
        if (gen !== this.applyGen) return;
        this.positionId = id;
        // createMultipointShape on this widget can drop times; setPoints is
        // what actually pins the left wall at the rec candle. Always write,
        // even when lastBar did not move during the promise.
        this.pinPosition(id, edges.left, edges.right, pending);
        this.stretchPosition({ evenIfFrozen: this.positionFrozen });
      })
      .catch(() => {});
  }

  /**
   * Grow the box's right edge to `lastBarTime` (ms or seconds of a bar
   * already in history). Same rec + same lastBar is a no-op — never
   * delete/recreate. A terminal plan ignores further advances. If the rec
   * arrived before any lastBar, this is also what first creates the box.
   */
  syncRightEdge(lastBarTime: number): void {
    if (!Number.isFinite(lastBarTime) || lastBarTime <= 0) return;
    this.liveLastBarSec = toSec(lastBarTime);
    this.stretchPosition();
  }

  private freezePosition(): void {
    if (this.lastRightSec != null) this.frozenRightSec = this.lastRightSec;
    else if (this.liveLastBarSec != null && this.positionLeftSec != null) {
      this.frozenRightSec = Math.max(this.liveLastBarSec, this.positionLeftSec);
    }
    this.positionFrozen = true;
  }

  /**
   * Write right = lastBar (or the frozen right, on recreate) via setPoints.
   * Left is always re-pinned to the print-time edge. The time we write is
   * never past lastBar — a future Close is the clamp-and-slide bug.
   */
  private stretchPosition(opts?: { evenIfFrozen?: boolean }): void {
    if (this.positionFrozen && !opts?.evenIfFrozen) return;
    if (this.positionId == null) {
      this.tryCreatePositionBox();
      return;
    }
    const pending = this.pendingBox;
    const left = this.positionLeftSec;
    if (!pending || left == null) return;
    const targetRight = this.positionFrozen
      ? this.frozenRightSec
      : this.liveLastBarSec;
    const edges = positionBoxEdges({
      leftSec: left,
      lastBarSec: targetRight,
    });
    if (!edges) return;
    if (this.lastRightSec === edges.right) return;
    this.pinPosition(this.positionId, edges.left, edges.right, pending);
    this.lastRightSec = edges.right;
  }

  /**
   * Force both unix-second corners AND stop/profit levels AND the no-extend
   * flags. createMultipointShape overrides are not enough on this widget —
   * leftover extendLeft/Right or dropped times are what painted the
   * infinite strip. Always called after create, even if lastBar did not move.
   */
  private pinPosition(
    id: EntityId,
    left: number,
    right: number,
    pending: {
      symbol: string;
      entry: PricedPointLike;
      takeProfit: number;
      stopLoss: number;
    },
  ): void {
    try {
      const shape = this.chart.getShapeById(id) as {
        setPoints: (points: ShapePoint[]) => void;
        setProperties?: (props: Record<string, unknown>) => void;
      };
      shape.setPoints(
        positionToolPoints(left, right, pending.entry.price) as ShapePoint[],
      );
      shape.setProperties?.({
        ...this.positionOverrides(pending),
      });
    } catch {
      /* shape not ready / already removed */
    }
  }

  /**
   * One native Long/Short Position spanning entry → furthest target (profit)
   * and entry → stop (risk). Every target stays visible as a numbered line
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
    this.hline(entry.price, "#3b82f6", "دخول");
    this.hline(stopLoss, "#ef4444", "وقف خسارة", true);
    targets.forEach((price, i) => {
      this.hline(
        price,
        price === edge ? "#22c55e" : "#3b82f6",
        targetLabel(i + 1),
      );
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
        if (tp) this.positionWithTargets(direction, entry, [tp], sl, symbol);
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
    ctx?: { symbol?: string; interval?: string; lastBarTime?: number },
    opts?: { force?: boolean },
  ): void {
    const rec0 = trade?.recommendation;
    if (ctx?.lastBarTime != null && ctx.lastBarTime > 0) {
      this.liveLastBarSec = toSec(ctx.lastBarTime);
    }
    const nextKey = tradeKeyOf(rec0);
    if (nextKey !== this.lastTradeKey) {
      this.positionFrozen = false;
      this.pendingTerminal = false;
      this.frozenRightSec = null;
      this.lastRightSec = null;
      this.positionLeftSec = null;
      this.pendingBox = null;
      this.lastTradeKey = nextKey;
    }
    const terminal = isTerminalChartRecommendation(rec0 ?? null);
    // Idempotence guard: the layout poll and unrelated re-renders re-deliver the
    // same payload every few seconds. Destroying and re-creating every shape for
    // an unchanged payload is what made agent drawings flicker and the position
    // tool jump — and it also snapped back any in-progress user adjustment.
    // lastBar is deliberately NOT in the fingerprint: a new candle updates
    // width via setPoints (syncRightEdge), never a delete/recreate.
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
    if (!opts?.force && fingerprint === this.lastFingerprint) {
      if (terminal && !this.positionFrozen) {
        this.stretchPosition();
        this.freezePosition();
      } else if (!this.positionFrozen) {
        this.stretchPosition();
      }
      return;
    }
    this.pendingTerminal = terminal;
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
        // One native Long/Short Position: Entry + Close at the entry price,
        // LEFT = printing candle when `anchor_time` is present (a leftover
        // wait converted to immediate), else persisted created_at (sticky
        // lastBar fallback for legacy payloads) so re-applies reproduce the
        // same shape instead of drifting to wall-clock "now" — never t=0,
        // never a future Close. stopLevel / profitLevel (furthest TP) live
        // on the same shape. Nearer TPs render as numbered lines inside it.
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
