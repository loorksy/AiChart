import type { StoredCandle } from "@/lib/candles/candleRepository";
import { isKnownForexSymbol } from "@/lib/markets/forexInstruments";
import { normalizeSymbol } from "@/lib/markets/symbolMapping";

import { requireResearchBacktestEnabled } from "./client";
import { ResearchServiceError } from "./errors";
import type {
  AiChartCandleWarehouseEnvelope,
  AiChartWarehouseExportInput,
  AiChartWarehouseExportBar,
  ResearchTimeframe,
} from "./types";

if (typeof window !== "undefined") {
  throw new Error("Research warehouse export is server-only");
}

/**
 * 50k bars ≈ 6 MiB of envelope JSON — inside the research-service 8 MiB
 * request cap with headroom. Unlocks 15m ≈ 17 months and 1h ≈ 5.7 years,
 * which the 100-trade evidence gate needs on intraday timeframes.
 */
const MAX_EXPORT_ROWS = 50_000;
const MAX_RANGE_MS = 10 * 366 * 24 * 60 * 60 * 1000;
const DURATION_MS: Record<ResearchTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/**
 * Same coverage gate `strategies/pipeline.ts`'s `submitStrategyBacktest`
 * checks on the returned bar count — duplicated here (not imported) to avoid
 * a layering cycle (`pipeline.ts` already imports this module). Keep these
 * two numbers in sync if either changes.
 */
const MIN_SUFFICIENT_BARS = 200;
const MIN_DEPTH_FRACTION = 0.5;
/** Below this fraction of the disjoint OANDA window, warm demand + fire a backfill. */
const ANALYSIS_THIN_FRACTION = 0.5;

function invalid(message: string): never {
  throw new ResearchServiceError("RESEARCH_INPUT_INVALID", message, 400);
}

function validatedInput(input: AiChartWarehouseExportInput, nowMs: number) {
  const symbol = normalizeSymbol(input.symbol).canonical;
  if (!/^[A-Z]{6}$/.test(symbol) || !isKnownForexSymbol(symbol)) {
    invalid("warehouse export symbol is unsupported");
  }
  if (!Object.hasOwn(DURATION_MS, input.timeframe)) {
    invalid("warehouse export timeframe is unsupported");
  }
  const limit = input.limit ?? 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPORT_ROWS) {
    invalid("warehouse export row limit is invalid");
  }
  for (const [label, value] of [
    ["from", input.fromMs],
    ["to", input.toMs],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      invalid(`warehouse export ${label} time is invalid`);
    }
  }
  if (input.fromMs !== undefined && input.fromMs > nowMs) {
    invalid("warehouse export start cannot be in the future");
  }
  if (input.toMs !== undefined && input.toMs > nowMs) {
    invalid("warehouse export end cannot be in the future");
  }
  if (input.fromMs !== undefined) {
    const effectiveEnd = input.toMs ?? nowMs;
    if (input.fromMs > effectiveEnd) invalid("warehouse export range is reversed");
    if (effectiveEnd - input.fromMs > MAX_RANGE_MS) {
      invalid("warehouse export range exceeds the supported maximum");
    }
  }
  return { symbol, timeframe: input.timeframe, limit };
}

function validateCandle(candle: StoredCandle): void {
  if (
    !Number.isSafeInteger(candle.time) ||
    candle.time <= 0 ||
    ![candle.open, candle.high, candle.low, candle.close].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    !Number.isFinite(candle.volume) ||
    candle.volume < 0
  ) {
    invalid("warehouse returned an invalid candle");
  }
  if (
    candle.high < Math.max(candle.open, candle.low, candle.close) ||
    candle.low > Math.min(candle.open, candle.high, candle.close)
  ) {
    invalid("warehouse returned invalid OHLC data");
  }
}

export function buildAiChartCandleWarehouseEnvelope(
  input: AiChartWarehouseExportInput,
  candles: readonly StoredCandle[],
  exportedAt: Date,
): AiChartCandleWarehouseEnvelope {
  const nowMs = exportedAt.getTime();
  if (!Number.isFinite(nowMs)) invalid("warehouse export timestamp is invalid");
  const normalized = validatedInput(input, nowMs);
  if (candles.length > normalized.limit || candles.length > MAX_EXPORT_ROWS) {
    invalid("warehouse returned more rows than authorized");
  }
  const complete = candles.filter((candle) => candle.complete === true);
  if (!complete.length) invalid("warehouse export contains no closed candles");
  const bars: AiChartWarehouseExportBar[] = [];
  let previousTime = -1;
  for (const candle of complete) {
    validateCandle(candle);
    if (candle.time <= previousTime) invalid("warehouse candles are duplicate or unordered");
    previousTime = candle.time;
    if (
      (input.fromMs !== undefined && candle.time < input.fromMs) ||
      (input.toMs !== undefined && candle.time > input.toMs)
    ) {
      invalid("warehouse returned a candle outside the authorized range");
    }
    if (candle.time + DURATION_MS[normalized.timeframe] > nowMs) {
      invalid("warehouse marked an unfinished candle as complete");
    }
    bars.push({
      timestamp: new Date(candle.time).toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      spread: null,
      symbol: normalized.symbol,
      timeframe: normalized.timeframe,
      source: "aichart_candle_warehouse",
      is_closed: true,
      timezone: "UTC",
    });
  }
  return {
    schema_version: "aichart-candle-warehouse-v1",
    source: "aichart_candle_warehouse",
    exported_at: exportedAt.toISOString(),
    closed_bars_only: true,
    bars,
  };
}

/**
 * When the MT (`getCandles`) coverage for the requested window is too thin
 * by `submitStrategyBacktest`'s own gate, fill the gap from
 * `getAnalysisCandles` (OANDA, analysis-only) — but ONLY the strictly older
 * time window MT does not cover, never interleaved with MT bars at the same
 * timestamp. Mixing two providers' bars for one timestamp would silently
 * corrupt indicator continuity, so the two series are kept in disjoint,
 * non-overlapping time ranges and simply concatenated in time order.
 *
 * Never merges when `fromMs` is unset: without a fixed range there is no
 * window boundary to hand OANDA, so the caller gets exactly what it asked
 * for (MT-only), same as before this fallback existed.
 */
async function supplementFromAnalysisSource(params: {
  symbol: string;
  timeframe: ResearchTimeframe;
  fromMs: number;
  toMs: number;
  limit: number;
  mtCandles: StoredCandle[];
}): Promise<StoredCandle[]> {
  // Only splice when the analysis source is actually configured. This function
  // is reached from Lonora's own paths — `deepAnalysis/enqueue.ts` (a live
  // analysis turn) and `strategies/pipeline.ts` (the mass-backtest cron) — and
  // the envelope it feeds stamps every bar `aichart_candle_warehouse`, so a
  // spliced bar is indistinguishable downstream from the operator's own broker
  // history. Without this gate the read still runs with no OANDA credentials
  // set anywhere, and thin MT depth quietly turns what used to be an honest
  // "backfill first" failure into a passing backtest over foreign bars — and
  // backtest evidence is what gates recommendations.
  const { oandaConfigured } = await import("@/lib/markets/oanda");
  if (!oandaConfigured()) return params.mtCandles;

  const step = DURATION_MS[params.timeframe];
  const mtComplete = params.mtCandles.filter((candle) => candle.complete);

  // The oldest MT bar in range is the boundary: OANDA may only fill strictly
  // older than that (never the same or a later timestamp).
  const mtEarliest = mtComplete.length
    ? Math.min(...mtComplete.map((candle) => candle.time))
    : null;
  const analysisToMs = mtEarliest != null ? mtEarliest - step : params.toMs;
  if (analysisToMs < params.fromMs) {
    // MT's earliest bar already sits at/before the requested start — nothing
    // older is left for OANDA to add.
    return params.mtCandles;
  }
  // Budgeted against the RAW (not complete-only) MT count: the combined
  // array is what `buildAiChartCandleWarehouseEnvelope` checks against
  // `normalized.limit` before it filters down to complete bars.
  const remainingBudget = Math.max(0, params.limit - params.mtCandles.length);
  if (remainingBudget === 0) return params.mtCandles;

  const { getAnalysisCandles } = await import("@/lib/candles/analysisCandleRepository");
  const analysisCandles = await getAnalysisCandles({
    symbol: params.symbol,
    interval: params.timeframe,
    fromMs: params.fromMs,
    toMs: analysisToMs,
    limit: remainingBudget,
    order: "asc",
  });

  // Warm demand for next time whenever the analysis-only store itself turns
  // out thin for this disjoint window — same "record demand, fire a
  // fire-and-forget backfill" pattern `warehouseOhlc.ts`/`warmDemand.ts`
  // already use for the MT case, reused rather than reinvented.
  const expectedAnalysisBars = Math.max(
    1,
    Math.floor((analysisToMs - params.fromMs) / step) + 1,
  );
  const analysisTarget = Math.min(remainingBudget, expectedAnalysisBars);
  if (analysisCandles.length < analysisTarget * ANALYSIS_THIN_FRACTION) {
    const [{ recordWarmDemand }, { triggerAnalysisBackfill }] = await Promise.all([
      import("@/lib/candles/warmDemand"),
      import("@/lib/candles/oandaBackfillService"),
    ]);
    void recordWarmDemand({ symbol: params.symbol, interval: params.timeframe });
    triggerAnalysisBackfill({
      symbol: params.symbol,
      interval: params.timeframe,
      fromMs: params.fromMs,
      toMs: analysisToMs,
    });
  }

  if (!analysisCandles.length) return params.mtCandles;
  return [...analysisCandles, ...params.mtCandles].sort((a, b) => a.time - b.time);
}

export async function exportAiChartCandleWarehouse(
  input: AiChartWarehouseExportInput,
): Promise<AiChartCandleWarehouseEnvelope> {
  requireResearchBacktestEnabled();
  const exportedAt = new Date();
  const normalized = validatedInput(input, exportedAt.getTime());
  const toMs = input.toMs ?? exportedAt.getTime();
  const { getCandles } = await import("@/lib/candles/candleRepository");
  const mtCandles = await getCandles({
    symbol: normalized.symbol,
    interval: normalized.timeframe,
    fromMs: input.fromMs,
    toMs,
    limit: normalized.limit,
  });

  let candles = mtCandles;
  if (input.fromMs !== undefined) {
    const mtCompleteCount = mtCandles.filter((candle) => candle.complete).length;
    const expectedCalendarBars = Math.ceil((toMs - input.fromMs) / DURATION_MS[normalized.timeframe]);
    const minimumDepth = Math.max(
      MIN_SUFFICIENT_BARS,
      Math.floor(expectedCalendarBars * MIN_DEPTH_FRACTION),
    );
    if (mtCompleteCount < minimumDepth) {
      candles = await supplementFromAnalysisSource({
        symbol: normalized.symbol,
        timeframe: normalized.timeframe,
        fromMs: input.fromMs,
        toMs,
        limit: normalized.limit,
        mtCandles,
      });
    }
  }

  return buildAiChartCandleWarehouseEnvelope(input, candles, exportedAt);
}
