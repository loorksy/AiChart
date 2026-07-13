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

const MAX_EXPORT_ROWS = 10_000;
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

export async function exportAiChartCandleWarehouse(
  input: AiChartWarehouseExportInput,
): Promise<AiChartCandleWarehouseEnvelope> {
  requireResearchBacktestEnabled();
  const exportedAt = new Date();
  const normalized = validatedInput(input, exportedAt.getTime());
  const { getCandles } = await import("@/lib/candles/candleRepository");
  const candles = await getCandles({
    symbol: normalized.symbol,
    interval: normalized.timeframe,
    fromMs: input.fromMs,
    toMs: input.toMs ?? exportedAt.getTime(),
    limit: normalized.limit,
  });
  return buildAiChartCandleWarehouseEnvelope(input, candles, exportedAt);
}
