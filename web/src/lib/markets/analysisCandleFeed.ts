/**
 * Shared "warehouse, then live" candle read for the ANALYSIS-ONLY data path
 * (plan "إعادة OANDA كمصدر بيانات تحليلي فقط"). No `userId`, no linked-account
 * concept — this is the same shape `fetchQuantAgentAnalysisBars`
 * (`@/lib/quantAgent/marketFeed`) builds on for the Quant Agent cron, and the
 * five analysis-only MCP bridge routes (`get_ohlc`, `get_forex_indicators`,
 * `scan_market`, `detect_levels`, `detect_market_regime`) build on for a user
 * with no linked account, so both call this one implementation instead of
 * each re-deriving "read the warehouse, fall back to a live pull."
 *
 * This file is deliberately NOT under `@/lib/quantAgent/` — it is generic
 * infrastructure several unrelated callers share, not Quant Agent-specific
 * logic. It is safe to import `analysisCandleRepository.ts`/`markets/oanda.ts`
 * here: this file is not on `analysisIsolation.test.ts`'s protected list, and
 * none of the protected files (the chart, Lonora's live decision path) import
 * this one.
 */
import { normalizeInterval } from "@/lib/intervals";
import { forexCanonicalKey } from "./forexCanonical";
import { getAnalysisCandles } from "@/lib/candles/analysisCandleRepository";
import {
  fetchOandaCandles,
  oandaConfigured,
  toOandaGranularity,
  toOandaInstrument,
} from "@/lib/markets/oanda";

export interface AnalysisFeedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AnalysisFeedResult {
  symbol: string;
  interval: string;
  candles: AnalysisFeedCandle[];
  warning?: string;
}

/** Neutral book label for the analysis-only fallback — never the literal provider name; reaches the LLM. */
export const ANALYSIS_BOOK_LABEL = "reference_feed";

/** Warehouse coverage below this fraction of the requested limit is "thin" — fall back to a live pull. */
const MIN_COVERAGE_RATIO = 0.9;

/**
 * Reads the analysis warehouse first; when coverage is thin it replaces the
 * series with one live pull (never merges two pulls from the same source —
 * there is no cross-provider continuity concern here since both reads are
 * the same feed, unlike the backtest's MT+analysis envelope stitching).
 */
export async function fetchAnalysisCandleFeed(
  symbolRaw: string,
  intervalRaw: string,
  limitRaw: number,
): Promise<AnalysisFeedResult> {
  const symbol = forexCanonicalKey(symbolRaw);
  const interval = normalizeInterval(intervalRaw);
  const limit = Math.min(Math.max(1, Math.floor(limitRaw) || 200), 5000);

  let warning: string | undefined;
  const warehouse = await getAnalysisCandles({ symbol, interval, limit, order: "asc" });
  let candles: AnalysisFeedCandle[] = warehouse;
  const sufficient = warehouse.length >= Math.ceil(limit * MIN_COVERAGE_RATIO);

  if (!sufficient) {
    if (!oandaConfigured()) {
      if (!warehouse.length) {
        warning = "مصدر بيانات التحليل غير مُفعَّل على مستوى المنصة.";
      }
    } else if (!toOandaInstrument(symbol) || !toOandaGranularity(interval)) {
      if (!warehouse.length) {
        warning = `الرمز ${symbol} أو الإطار ${interval} غير مدعوم من مصدر بيانات التحليل.`;
      }
    } else {
      try {
        const live = await fetchOandaCandles(symbol, interval, limit);
        if (live.candles.length) {
          candles = live.candles.map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? 0,
          }));
        } else if (!warehouse.length) {
          warning = "تعذّر جلب شموع التحليل.";
        }
      } catch (e) {
        if (!warehouse.length) {
          warning = e instanceof Error ? e.message : "تعذّر جلب شموع التحليل.";
        }
      }
    }
  }

  return { symbol, interval, candles: candles.slice(-limit), warning };
}
