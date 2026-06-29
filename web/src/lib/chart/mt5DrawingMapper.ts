import type { ChartDrawing, ChartPoint } from "@/lib/chartDrawings";
import { normalizeTimestamp } from "@/lib/chart/chartTimeAnchor";
import { labelForDrawing } from "@/lib/chart/chartTerminology";
import type { EaDrawingObjectPayload } from "@/lib/types";

function seconds(time: number | undefined): number {
  const ms = normalizeTimestamp(time ?? 0);
  return ms > 0 ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function point(p: ChartPoint): { time: number; price: number } {
  return { time: seconds(p.time), price: p.price };
}

function colorOf(d: ChartDrawing): string {
  return d.color ?? d.fill_color ?? "#60a5fa";
}

function lineStyleOf(d: ChartDrawing): "solid" | "dash" | "dot" {
  if (d.style === "dashed") return "dash";
  if (d.style === "dotted") return "dot";
  return "solid";
}

function objectTypeFor(d: ChartDrawing): string {
  switch (d.type) {
    case "price_line":
    case "hline":
    case "baseline":
      return "OBJ_HLINE";
    case "trend_line":
    case "trend":
    case "trendline":
    case "neckline":
    case "ray":
      return "OBJ_TREND";
    case "zone":
    case "range_box":
    case "supply_zone":
    case "demand_zone":
    case "decision_zone":
    case "retest_zone":
    case "rectangle":
      return "OBJ_RECTANGLE";
    case "triangle":
      return "OBJ_TRIANGLE";
    case "breakout_arrow":
    case "labeled_arrow":
    case "arrow":
    case "arrow_up":
    case "arrow_down":
    case "arrow_buy":
    case "arrow_sell":
      return "OBJ_ARROW";
    case "pattern_label":
    case "text":
    case "label":
      return "OBJ_TEXT";
    default:
      return "OBJ_TREND";
  }
}

function drawingKey(d: ChartDrawing, index: number): string {
  const label = labelForDrawing(d).replace(/\s+/g, "_");
  const t = d.points?.[0]?.time ?? d.price ?? index;
  return `aichart_${d.type}_${label}_${Math.abs(Math.trunc(Number(t)))}`;
}

function basePayload(
  d: ChartDrawing,
  index: number,
  symbol: string,
  timeframe: string,
  points: Array<{ time: number; price: number }>,
  suffix = "",
): EaDrawingObjectPayload {
  return {
    drawing_id: `${drawingKey(d, index)}${suffix}`,
    symbol,
    timeframe,
    object_type: objectTypeFor(d),
    points,
    label: labelForDrawing(d),
    source: "aichart",
    style: {
      color: colorOf(d),
      width: d.width ?? 1,
      lineStyle: lineStyleOf(d),
      fillColor: d.fill_color,
    },
  };
}

function effectivePoints(d: ChartDrawing): Array<{ time: number; price: number }> {
  const pts = (d.points ?? []).filter((p) => Number.isFinite(p.price) && p.price > 0);
  if (pts.length) return pts.map(point);
  const t = seconds((d.meta?.pointTimes as number[] | undefined)?.[0]);
  return [d.price, d.price2, d.price3]
    .filter((p): p is number => typeof p === "number" && p > 0)
    .map((price) => ({ time: t, price }));
}

export function mapChartDrawingToMt5Objects(
  d: ChartDrawing,
  index: number,
  opts: { symbol: string; timeframe: string },
): EaDrawingObjectPayload[] {
  const points = effectivePoints(d);
  if (!points.length) return [];

  if (d.type === "risk_reward_box") {
    const entry = d.meta?.entry ?? d.price ?? points[0]?.price;
    const stop = d.meta?.stopLoss ?? d.price2 ?? points[1]?.price;
    const target = d.meta?.takeProfit ?? d.price3 ?? points[2]?.price;
    const startTime = points[0]?.time ?? seconds();
    const endTime = points[points.length - 1]?.time ?? startTime;
    if (!entry || !stop || !target) return [];
    const mk = (name: string, price: number, color: string, suffix: string) => ({
      ...basePayload(
        { ...d, type: "price_line", color, label: name },
        index,
        opts.symbol,
        opts.timeframe,
        [{ time: startTime, price }],
        suffix,
      ),
      parent_drawing_id: drawingKey(d, index),
    });
    return [
      {
        ...basePayload(d, index, opts.symbol, opts.timeframe, [
          { time: startTime, price: target },
          { time: endTime, price: stop },
        ]),
        object_type: "OBJ_RECTANGLE",
      },
      mk("دخول", entry, "#3b82f6", "_entry"),
      mk("وقف الخسارة", stop, "#ef4444", "_sl"),
      mk("هدف", target, "#22c55e", "_tp"),
    ];
  }

  if (d.type === "polyline_pattern" || d.type === "forecast_path") {
    const out: EaDrawingObjectPayload[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      out.push({
        ...basePayload(d, index, opts.symbol, opts.timeframe, [points[i]!, points[i + 1]!], `_seg_${i}`),
        object_type: "OBJ_TREND",
        parent_drawing_id: drawingKey(d, index),
      });
    }
    return out;
  }

  if (d.type === "triangle" && points.length < 3) {
    return [];
  }

  return [basePayload(d, index, opts.symbol, opts.timeframe, points)];
}

export function mapChartDrawingsToMt5Objects(
  drawings: ChartDrawing[],
  opts: { symbol: string; timeframe: string },
): EaDrawingObjectPayload[] {
  return drawings.flatMap((d, i) => mapChartDrawingToMt5Objects(d, i, opts));
}
