import type { ChartDrawing, ChartPoint } from "@/lib/chartDrawings";
import type { KLinePoint } from "@/lib/chart/klineDrawingAdapter";

/** Minimal candle shape for time→index resolution. */
export interface CandleLike {
  timestamp: number;
}

/** Normalize Unix timestamp to milliseconds. */
export function normalizeTimestamp(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  return t < 1e12 ? t * 1000 : t;
}

/** Index of nearest candle by timestamp (binary search). */
export function nearestCandleIndex(candles: CandleLike[], timeMs: number): number | null {
  if (candles.length === 0) return null;
  const target = normalizeTimestamp(timeMs);
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid]!.timestamp < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const d0 = Math.abs(candles[lo]!.timestamp - target);
    const d1 = Math.abs(candles[lo - 1]!.timestamp - target);
    if (d1 < d0) return lo - 1;
  }
  return lo;
}

export interface PointToKLineOptions {
  allowBarsAhead?: boolean;
  fallbackLastIndex?: number;
}

/**
 * Resolve a ChartPoint to KLineCharts overlay coordinates.
 * Historical points MUST use time+price; barsAhead only when allowBarsAhead (forecast_path).
 */
export function pointToKLinePoint(
  point: ChartPoint,
  candles: CandleLike[],
  opts: PointToKLineOptions = {},
): KLinePoint | null {
  const { allowBarsAhead = false, fallbackLastIndex } = opts;
  const lastIndex = fallbackLastIndex ?? Math.max(0, candles.length - 1);

  if (point.time != null && point.time > 0) {
    const idx = nearestCandleIndex(candles, point.time);
    if (idx == null) return null;
    return { dataIndex: idx, value: point.price, timestamp: normalizeTimestamp(point.time) };
  }

  if (allowBarsAhead && point.barsAhead != null) {
    const idx = lastIndex + point.barsAhead;
    if (idx < 0) return null;
    return { dataIndex: idx, value: point.price };
  }

  // Legacy time_offset fallback
  if (point.time_offset != null && fallbackLastIndex != null) {
    const idx = lastIndex + point.time_offset;
    if (idx < 0 || idx >= candles.length) return null;
    return { dataIndex: idx, value: point.price };
  }

  return null;
}

/** Whether a drawing type may use barsAhead on future points. */
export function allowsBarsAhead(type: string): boolean {
  return type === "forecast_path";
}

/** Resolve all points for a drawing; returns null if any required point fails. */
export function drawingPointsToKLine(
  d: ChartDrawing,
  candles: CandleLike[],
): KLinePoint[] | null {
  const lastIndex = Math.max(0, candles.length - 1);
  const allowBars = allowsBarsAhead(d.type);

  if (Array.isArray(d.points) && d.points.length > 0) {
    const out: KLinePoint[] = [];
    for (const p of d.points) {
      const kp = pointToKLinePoint(p, candles, { allowBarsAhead: allowBars, fallbackLastIndex: lastIndex });
      if (!kp) return null;
      out.push(kp);
    }
    return out;
  }

  // Flat price coords — try time from meta or skip
  const flat: KLinePoint[] = [];
  const prices = [d.price, d.price2, d.price3];
  const times = (d.meta?.pointTimes as number[] | undefined) ?? [];
  for (let i = 0; i < prices.length; i++) {
    const v = prices[i];
    if (typeof v !== "number" || v <= 0) continue;
    const t = times[i];
    const kp = pointToKLinePoint(
      { price: v, time: t, barsAhead: d.time_offset != null && i === 0 ? d.time_offset : undefined },
      candles,
      { allowBarsAhead: allowBars, fallbackLastIndex: lastIndex },
    );
    if (!kp) return null;
    flat.push(kp);
  }
  return flat.length ? flat : null;
}

export function isDrawingVisible(d: ChartDrawing, candles: CandleLike[]): boolean {
  if (candles.length === 0) return false;
  const pts = d.points ?? [];
  if (pts.length === 0) return true;
  for (const p of pts) {
    if (p.time != null && nearestCandleIndex(candles, p.time) != null) return true;
    if (allowsBarsAhead(d.type) && p.barsAhead != null) {
      const idx = candles.length - 1 + p.barsAhead;
      if (idx >= 0 && idx < candles.length) return true;
    }
  }
  return false;
}

/** Fill missing time from barsAhead using candle array (one-time migration). */
export function enrichDrawingsWithTime(
  drawings: ChartDrawing[],
  candles: { time: number }[],
): ChartDrawing[] {
  if (candles.length === 0) return drawings;
  const lastIndex = candles.length - 1;

  return drawings.map((d) => {
    const allowBars = allowsBarsAhead(d.type);
    const points = (d.points ?? []).map((p) => {
      if (p.time != null && p.time > 0) {
        return { ...p, time: normalizeTimestamp(p.time) };
      }
      if (!allowBars && p.barsAhead != null) {
        const idx = lastIndex + p.barsAhead;
        if (idx >= 0 && idx < candles.length) {
          return { ...p, time: normalizeTimestamp(candles[idx]!.time) };
        }
      }
      return p;
    });
    return { ...d, points, anchorMode: d.anchorMode ?? "time_price" };
  });
}

/** Drop drawings whose historical points lack time after enrichment. */
export function assertTimeAnchored(
  drawings: ChartDrawing[],
  candles: { time: number }[],
): ChartDrawing[] {
  const enriched = enrichDrawingsWithTime(drawings, candles);
  return enriched.filter((d) => {
    if (allowsBarsAhead(d.type)) return true;
    const pts = d.points ?? [];
    if (pts.length === 0) return d.price != null && d.price > 0;
    return pts.every((p) => p.time != null && p.time > 0);
  });
}

/** Attach symbol-level drawing scope. */
export function attachDrawingScope(
  drawings: ChartDrawing[],
  symbol: string,
  market: string,
  sourceTimeframe?: string,
): ChartDrawing[] {
  return drawings.map((d) => ({
    ...d,
    anchorMode: "time_price" as const,
    meta: {
      ...d.meta,
      drawing_scope: { symbol, market, anchorMode: "time_price" as const },
      ...(sourceTimeframe ? { sourceTimeframe } : {}),
    },
  }));
}
