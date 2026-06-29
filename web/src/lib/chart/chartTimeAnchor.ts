import type { ChartDrawing, ChartPoint } from "@/lib/chartDrawings";
import type { KLinePoint } from "@/lib/chart/klineDrawingAdapter";

/** Minimal candle shape for time→index resolution. */
export interface CandleLike {
  timestamp: number;
}

export type AnyCandle = { time?: number; timestamp?: number };

/** Normalize Unix timestamp to milliseconds. */
export function normalizeTimestamp(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  return t < 1e12 ? t * 1000 : t;
}

export function candleTimeMs(c: AnyCandle): number {
  return normalizeTimestamp(c.timestamp ?? c.time ?? 0);
}

export function toCandleLike(candles: AnyCandle[]): CandleLike[] {
  return candles.map((c) => ({ timestamp: candleTimeMs(c) }));
}

function candleAt(candles: AnyCandle[], index: number): number {
  if (candles.length === 0) return 0;
  const i = Math.max(0, Math.min(candles.length - 1, index));
  return candleTimeMs(candles[i]!);
}

/** Spread N anchor times across the visible chart window. */
function spreadTime(candles: AnyCandle[], count: number, index: number): number {
  if (candles.length === 0) return 0;
  if (count <= 1) return candleAt(candles, candles.length - 1);
  const start = Math.floor(candles.length * 0.15);
  const end = candles.length - 1;
  const idx = start + Math.round((index / (count - 1)) * (end - start));
  return candleAt(candles, idx);
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
  allowPriceOnly?: boolean;
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
  const { allowBarsAhead = false, fallbackLastIndex, allowPriceOnly = true } = opts;
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

  // Price-only horizontal anchor (not when barsAhead was intended)
  if (
    typeof point.price === "number" &&
    point.price > 0 &&
    candles.length > 0 &&
    allowPriceOnly &&
    point.barsAhead == null &&
    (point.time == null || point.time <= 0)
  ) {
    return { dataIndex: lastIndex, value: point.price };
  }

  return null;
}

/** Whether a drawing type may use barsAhead on future points. */
export function allowsBarsAhead(type: string): boolean {
  return type === "forecast_path";
}

export function allowsPriceOnlyAnchor(type: string): boolean {
  return type === "price_line" || type === "hline" || type === "baseline";
}

function expandLegacyPriceFields(d: ChartDrawing, candles: AnyCandle[]): ChartDrawing {
  if ((d.points?.length ?? 0) > 0) return d;
  const prices = [d.price, d.price2, d.price3].filter(
    (p): p is number => typeof p === "number" && p > 0,
  );
  if (!prices.length) return d;
  const points = prices.map((price, i) => ({
    price,
    time: spreadTime(candles, prices.length, i),
  }));
  return { ...d, points };
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
      const kp = pointToKLinePoint(p, candles, {
        allowBarsAhead: allowBars,
        allowPriceOnly: allowsPriceOnlyAnchor(d.type),
        fallbackLastIndex: lastIndex,
      });
      if (!kp) return null;
      out.push(kp);
    }
    return out;
  }

  const flat: KLinePoint[] = [];
  const prices = [d.price, d.price2, d.price3];
  const times = (d.meta?.pointTimes as number[] | undefined) ?? [];
  for (let i = 0; i < prices.length; i++) {
    const v = prices[i];
    if (typeof v !== "number" || v <= 0) continue;
    const t = times[i];
    const kp = pointToKLinePoint(
      {
        price: v,
        time: t,
        barsAhead: d.time_offset != null && i === 0 ? d.time_offset : undefined,
      },
      candles,
      {
        allowBarsAhead: allowBars,
        allowPriceOnly: allowsPriceOnlyAnchor(d.type),
        fallbackLastIndex: lastIndex,
      },
    );
    if (!kp) return null;
    flat.push(kp);
  }
  return flat.length ? flat : null;
}

export function isDrawingVisible(d: ChartDrawing, candles: CandleLike[]): boolean {
  if (candles.length === 0) return false;
  const pts = d.points ?? [];
  if (pts.length === 0) return typeof d.price === "number" && d.price > 0;
  for (const p of pts) {
    if (p.time != null && nearestCandleIndex(candles, p.time) != null) return true;
    if (allowsBarsAhead(d.type) && p.barsAhead != null) {
      const idx = candles.length - 1 + p.barsAhead;
      if (idx >= 0) return true;
    }
    if (typeof p.price === "number" && p.price > 0) return true;
  }
  return false;
}

/** Fill missing time from barsAhead, candle table, or chart window spread. */
export function enrichDrawingsWithTime(
  drawings: ChartDrawing[],
  candles: AnyCandle[],
): ChartDrawing[] {
  if (candles.length === 0) return drawings;
  const lastIndex = candles.length - 1;

  return drawings.map((raw) => {
    const d = expandLegacyPriceFields(raw, candles);
    const allowBars = allowsBarsAhead(d.type);
    const pts = d.points ?? [];
    const points = pts.map((p, pi) => {
      if (p.time != null && p.time > 0) {
        return { ...p, time: normalizeTimestamp(p.time) };
      }
      if (!allowBars && p.barsAhead != null) {
        const idx = lastIndex + p.barsAhead;
        if (idx >= 0 && idx < candles.length) {
          return { ...p, time: candleTimeMs(candles[idx]!) };
        }
      }
      if (typeof p.price === "number" && p.price > 0) {
        return { ...p, time: spreadTime(candles, pts.length || 1, pi) };
      }
      return p;
    });
    return { ...d, points, anchorMode: d.anchorMode ?? "time_price" };
  });
}

/** Drop drawings whose historical points lack time after enrichment. */
export function assertTimeAnchored(
  drawings: ChartDrawing[],
  candles: AnyCandle[],
): ChartDrawing[] {
  const enriched = enrichDrawingsWithTime(drawings, candles);
  return enriched.filter((d) => {
    if (allowsBarsAhead(d.type)) return true;
    const pts = d.points ?? [];
    if (pts.length === 0) return typeof d.price === "number" && d.price > 0;
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
