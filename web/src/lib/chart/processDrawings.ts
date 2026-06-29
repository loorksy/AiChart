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

/** Post-process pipeline: time anchor → labels → cap → validate → scope. */
export function processAgentDrawings(
  drawings: ChartDrawing[],
  opts: ProcessDrawingsOptions,
): ChartDrawing[] {
  if (drawings.length === 0) return [];

  const enriched = enrichDrawingsWithTime(drawings, opts.candles);
  const anchored = assertTimeAnchored(enriched, opts.candles);
  const labeled = sanitizeDrawingLabels(anchored);
  const capped = filterAndCapDrawings(labeled, { decision: opts.decision });
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
