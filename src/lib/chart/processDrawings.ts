import type { AnalysisProfile } from "@/lib/analysisProfile";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { validateChartDrawings } from "@/lib/chartDrawings";
import {
  assertTimeAnchored,
  attachDrawingScope,
  enrichDrawingsWithTime,
} from "@/lib/chart/chartTimeAnchor";
import { sanitizeDrawingLabels } from "@/lib/chart/chartTerminology";
import { filterAndCapDrawings } from "@/lib/chart/drawingFilter";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";

export interface ProcessDrawingsOptions {
  candles: OhlcCandle[];
  decision: "buy" | "sell" | "wait";
  confidence: number;
  profile: AnalysisProfile;
  symbol: string;
  market: string;
  sourceTimeframe?: string;
}

function drawingPriceBounds(candles: OhlcCandle[]) {
  if (!candles.length) return null;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    if (Number.isFinite(candle.low)) low = Math.min(low, candle.low);
    if (Number.isFinite(candle.high)) high = Math.max(high, candle.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  const padding = (high - low) * 0.5;
  return { low: low - padding, high: high + padding };
}

function drawingPrices(drawing: ChartDrawing): number[] {
  const prices: number[] = [];
  for (const point of drawing.points ?? []) {
    if (Number.isFinite(point.price)) prices.push(point.price);
  }
  for (const value of [drawing.price, drawing.price2, drawing.price3]) {
    if (Number.isFinite(value)) prices.push(value as number);
  }
  for (const value of [
    drawing.meta?.entry,
    drawing.meta?.stopLoss,
    drawing.meta?.takeProfit,
  ]) {
    if (Number.isFinite(value)) prices.push(value as number);
  }
  return prices;
}

export function filterDrawingsByPriceBounds(
  drawings: ChartDrawing[],
  candles: OhlcCandle[],
): ChartDrawing[] {
  const bounds = drawingPriceBounds(candles);
  if (!bounds) return drawings;
  return drawings.filter((drawing) => {
    const prices = drawingPrices(drawing);
    if (!prices.length) return true;
    return prices.every((price) => price >= bounds.low && price <= bounds.high);
  });
}

/** Post-process pipeline: time anchor → labels → cap → validate → scope. */
export function processAgentDrawings(
  drawings: ChartDrawing[],
  opts: ProcessDrawingsOptions,
): ChartDrawing[] {
  if (drawings.length === 0) return [];

  const enriched = enrichDrawingsWithTime(drawings, opts.candles);
  const anchored = assertTimeAnchored(enriched, opts.candles);
  const labeled = sanitizeDrawingLabels(anchored);
  const bounded = filterDrawingsByPriceBounds(labeled, opts.candles);
  const capped = filterAndCapDrawings(bounded, { decision: opts.decision });
  const validated = validateChartDrawings(
    capped,
    opts.decision,
    opts.confidence,
    opts.profile,
  );
  return attachDrawingScope(
    validated,
    opts.symbol,
    opts.market,
    opts.sourceTimeframe,
  );
}

export function formatCandlesForPrompt(candles: OhlcCandle[], max = 80): string {
  const slice = candles.slice(-max);
  const lines = slice.map(
    (c) =>
      `{time:${c.time},o:${c.open.toFixed(5)},h:${c.high.toFixed(5)},l:${c.low.toFixed(5)},c:${c.close.toFixed(5)}}`,
  );
  return ["## آخر الشموع (time + OHLC — استخدم time في نقاط الرسم)", ...lines].join("\n");
}
