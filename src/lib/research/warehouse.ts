/**
 * The bridge from the gold candle store to the research service.
 *
 * The backtest pipeline speaks one dataset dialect — the
 * `aichart-candle-warehouse-v1` envelope — and its validator, its types, and
 * the Python service on the other side all survived the migration that deleted
 * the multi-symbol warehouse. What did NOT survive was the exporter, so
 * `strategy_backtests` had no way to get bars: nothing could run, nothing could
 * complete, `strategy_deployments` stayed empty, and G5 could never grade a
 * strategy because there was never a strategy record to grade.
 *
 * This is that missing half, rebuilt against the gold store. The envelope shape
 * is unchanged on purpose — the service already validates it, and inventing a
 * second dialect would mean changing both sides to say the same thing.
 */
import { readGoldCandles, STORED_TIMEFRAMES } from "@/lib/gold/candleStore";
import { DATA_SYMBOL } from "@/lib/gold";
import { ResearchServiceError } from "./errors";
import type {
  AiChartCandleWarehouseEnvelope,
  AiChartWarehouseExportBar,
  AiChartWarehouseExportInput,
  ResearchTimeframe,
} from "./types";

if (typeof window !== "undefined") {
  throw new Error("Research warehouse export is server-only");
}

/**
 * 50k bars ≈ 6 MiB of envelope JSON — inside the research-service 8 MiB request
 * cap with headroom. Unlocks 15m ≈ 17 months and 1h ≈ 5.7 years, which is what
 * the 100-trade evidence bar needs on intraday timeframes.
 *
 * MUST track MAX_WAREHOUSE_ENVELOPE_BARS in research/jobs.ts. These are two
 * independent ceilings on the same payload, and raising only the exporter
 * produces a valid envelope the validator then rejects.
 */
export const MAX_EXPORT_ROWS = 50_000;

const MAX_RANGE_MS = 10 * 366 * 24 * 60 * 60 * 1000;

function invalid(message: string): never {
  throw new ResearchServiceError("RESEARCH_INPUT_INVALID", message, 400);
}

function validatedInput(input: AiChartWarehouseExportInput, nowMs: number) {
  // Gold only. A different symbol is not a range error to clamp — it is a
  // request this platform cannot answer, and answering it with gold bars would
  // be worse than refusing.
  const symbol = String(input.symbol ?? "").toUpperCase().trim();
  if (symbol !== DATA_SYMBOL) {
    invalid(`warehouse export supports ${DATA_SYMBOL} only`);
  }
  if (!STORED_TIMEFRAMES.includes(input.timeframe)) {
    invalid("warehouse export timeframe is not kept in the store");
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

/**
 * Build the dataset envelope for one timeframe.
 *
 * Refuses an EMPTY result rather than shipping a zero-bar envelope. The
 * validator on the other side rejects it anyway, but the failure would arrive
 * as "invalid envelope" from a remote service instead of "the store has no
 * bars for this frame yet" — which is the fact the operator can act on, by
 * running the store sync.
 */
export async function exportGoldWarehouseEnvelope(
  input: AiChartWarehouseExportInput,
): Promise<AiChartCandleWarehouseEnvelope> {
  const now = Date.now();
  const { symbol, timeframe, limit } = validatedInput(input, now);

  const candles = await readGoldCandles({
    timeframe,
    fromMs: input.fromMs,
    toMs: input.toMs,
    limit,
  });
  if (!candles.length) {
    invalid(
      `the gold candle store holds no ${timeframe} bars for the requested range — run the store sync first`,
    );
  }

  const bars: AiChartWarehouseExportBar[] = candles.map((candle) => ({
    timestamp: new Date(candle.time).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    // The store keeps mid prices with no bid/ask, so there is no spread to
    // report. Null says that; a zero would claim a spread-free market.
    spread: null,
    symbol,
    timeframe: timeframe as ResearchTimeframe,
    source: "aichart_candle_warehouse",
    // Guaranteed by the store's write path, which never persists a forming bar.
    is_closed: true,
    timezone: "UTC",
  }));

  return {
    schema_version: "aichart-candle-warehouse-v1",
    source: "aichart_candle_warehouse",
    exported_at: new Date(now).toISOString(),
    closed_bars_only: true,
    bars,
  };
}
