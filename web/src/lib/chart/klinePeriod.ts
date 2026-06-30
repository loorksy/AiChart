import type { Period } from "@klinecharts/pro";
import { ALL_INTERVALS, normalizeInterval } from "@/lib/intervals";

const TIMESPAN_MAP: Record<string, Period["timespan"]> = {
  m: "minute",
  h: "hour",
  d: "day",
  w: "week",
  M: "month",
};

/** AiChart interval string → KLineChart Pro Period. */
export function intervalToPeriod(interval: string): Period {
  const iv = normalizeInterval(interval);
  const derived: Record<string, Period> = {
    "10m": { multiplier: 10, timespan: "minute", text: "10m" },
    "45m": { multiplier: 45, timespan: "minute", text: "45m" },
    "2d": { multiplier: 2, timespan: "day", text: "2D" },
    "2w": { multiplier: 2, timespan: "week", text: "2W" },
  };
  if (derived[iv]) return derived[iv]!;

  const m = iv.match(/^(\d+)(m|h|d|w|M)$/);
  if (!m) return { multiplier: 1, timespan: "hour", text: "1H" };

  const multiplier = Number(m[1]);
  const unit = m[2]!;
  const timespan = TIMESPAN_MAP[unit] ?? "minute";
  const text =
    unit === "h" && multiplier === 1
      ? "1H"
      : unit === "d" && multiplier === 1
        ? "D"
        : unit === "w" && multiplier === 1
          ? "W"
          : unit === "M" && multiplier === 1
            ? "M"
            : iv;

  return { multiplier, timespan, text };
}

export function periodToInterval(period: Period): string {
  const { multiplier, timespan } = period;
  switch (timespan) {
    case "minute":
      return `${multiplier}m`;
    case "hour":
      return `${multiplier}h`;
    case "day":
      return `${multiplier}d`;
    case "week":
      return `${multiplier}w`;
    case "month":
      return multiplier === 1 ? "1M" : `${multiplier}M`;
    case "year":
      return `${multiplier}y`;
    default:
      return "1h";
  }
}

/** Curated periods for KLineChart Pro toolbar — avoids 20+ buttons breaking mobile layout. */
export function proChartPeriods(): Period[] {
  return [
    "1m",
    "5m",
    "15m",
    "30m",
    "1h",
    "4h",
    "1d",
    "1w",
  ].map(intervalToPeriod);
}

/** All UI intervals as Pro period options (deduped by text). */
export function allChartPeriods(): Period[] {
  const seen = new Set<string>();
  const out: Period[] = [];
  for (const iv of ALL_INTERVALS) {
    const p = intervalToPeriod(iv);
    if (seen.has(p.text)) continue;
    seen.add(p.text);
    out.push(p);
  }
  return out;
}
