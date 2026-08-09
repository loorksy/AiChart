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
import { candleFreshnessToleranceMs } from "@/lib/markets/intervals";
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
  // NO `order: "asc"` here. That is `ORDER BY time ASC LIMIT n` with no range
  // bound — the OLDEST n rows in the store, not the latest window. With the
  // default `desc` the repository takes the newest n and returns them
  // ascending, which is what a "current market" feed means. The asc form is
  // for bounded completeness scans, and every caller of this function
  // (the Quant Agent crons and chat, and the analysis-only MCP tools) is
  // pricing a live decision off the tail.
  const warehouse = await getAnalysisCandles({ symbol, interval, limit });
  let candles: AnalysisFeedCandle[] = warehouse;

  // Depth alone is not sufficiency. Once the backfill service has more than
  // `limit` bars of history, a depth-only check is satisfied forever and no
  // live pull is ever made again, so the feed freezes on whatever window it
  // last read and silently gets staler every day. The tail must be recent too.
  const newest = warehouse.length ? warehouse[warehouse.length - 1]!.time : null;
  const staleBy = newest == null ? Infinity : Date.now() - newest;
  const fresh = staleBy <= candleFreshnessToleranceMs(interval);
  const sufficient = warehouse.length >= Math.ceil(limit * MIN_COVERAGE_RATIO) && fresh;

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

  const result = candles.slice(-limit);

  // Last line of defence: whatever path we took, if the series we are about to
  // hand back still ends in the past, say so. Callers price entries, stops and
  // targets off these bars and deliver them to real users over Telegram — an
  // old series with no warning attached is worse than no series at all,
  // because nothing downstream can tell the difference.
  if (!warning && result.length) {
    const tail = result[result.length - 1]!.time;
    const behindMs = Date.now() - tail;
    if (behindMs > candleFreshnessToleranceMs(interval)) {
      const behindHours = Math.floor(behindMs / 3_600_000);
      warning =
        `بيانات التحليل لـ${symbol} (${interval}) متأخرة بنحو ${behindHours} ساعة — ` +
        `آخر شمعة ${new Date(tail).toISOString()}. لا تُبنَ عليها قرارات سعرية.`;
    }
  }

  return { symbol, interval, candles: result, warning };
}
