import type { ChartDrawing } from "@/lib/chartDrawings";
import { isArrowDrawing, isZoneDrawing } from "@/lib/chartDrawings";

const MAX_TOTAL = 12;
const MAX_PRICE_LINE = 3;
const MAX_ZONES = 4;
const MAX_ARROWS = 2;

const PRICE_LINE_TYPES = new Set(["price_line", "hline", "baseline"]);

const PATTERN_TYPES = new Set([
  "polyline_pattern",
  "triangle",
  "neckline",
  "range_box",
  "channel",
  "parallel_channel",
  "regression_trend",
]);

const POSITION_TYPES = new Set(["long_position", "short_position"]);

function priceLevels(d: ChartDrawing): number[] {
  const out: number[] = [];
  for (const p of d.points ?? []) out.push(p.price);
  if (d.price != null) out.push(d.price);
  if (d.price2 != null) out.push(d.price2);
  if (d.price3 != null) out.push(d.price3);
  return out;
}

function nearLevel(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(a, b) * 0.001;
}

function dedupeLevels(drawings: ChartDrawing[]): ChartDrawing[] {
  const kept: ChartDrawing[] = [];
  const seen: number[] = [];
  for (const d of drawings) {
    const levels = priceLevels(d);
    const dup = levels.some((lv) => seen.some((s) => nearLevel(s, lv)));
    if (dup && PRICE_LINE_TYPES.has(d.type)) continue;
    kept.push(d);
    for (const lv of levels) seen.push(lv);
  }
  return kept;
}

function scoreDrawing(d: ChartDrawing): number {
  if (POSITION_TYPES.has(d.type)) return 110 + (d.confidence ?? 0);
  if (d.type === "forecast_path") return 105 + (d.confidence ?? 0);
  if (PATTERN_TYPES.has(d.type)) return 100 + (d.confidence ?? 0);
  if (d.type === "risk_reward_box") return 90 + (d.confidence ?? 0);
  if (isZoneDrawing(d.type)) return 70 + (d.confidence ?? 0);
  if (d.type === "trend_line") return 60 + (d.confidence ?? 0);
  if (isArrowDrawing(d.type)) return 55 + (d.confidence ?? 0);
  if (PRICE_LINE_TYPES.has(d.type)) return 30 + (d.confidence ?? 0);
  return 40 + (d.confidence ?? 0);
}

export interface FilterDrawingsOptions {
  decision?: "buy" | "sell" | "wait";
}

export function filterAndCapDrawings(
  drawings: ChartDrawing[],
  opts: FilterDrawingsOptions = {},
): ChartDrawing[] {
  let list = [...drawings];

  if (opts.decision === "wait") {
    list = list.filter(
      (d) =>
        d.type !== "risk_reward_box" &&
        !POSITION_TYPES.has(d.type) &&
        d.semanticRole !== "entry" &&
        d.semanticRole !== "stop_loss" &&
        d.semanticRole !== "take_profit" &&
        d.semanticRole !== "risk_reward",
    );
  }

  list = dedupeLevels(list);
  list.sort((a, b) => scoreDrawing(b) - scoreDrawing(a));

  const out: ChartDrawing[] = [];
  let priceLines = 0;
  let zones = 0;
  let arrows = 0;

  for (const d of list) {
    if (out.length >= MAX_TOTAL) break;
    if (PRICE_LINE_TYPES.has(d.type)) {
      if (priceLines >= MAX_PRICE_LINE) continue;
      priceLines++;
    }
    if (isZoneDrawing(d.type)) {
      if (zones >= MAX_ZONES) continue;
      zones++;
    }
    if (isArrowDrawing(d.type)) {
      if (arrows >= MAX_ARROWS) continue;
      arrows++;
    }
    out.push(d);
  }

  return out;
}
