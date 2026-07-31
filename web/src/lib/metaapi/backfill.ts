import { upsertCandles } from "@/lib/candles/candleRepository";
import { getRpcConnection } from "./client";
import { metaapiUxEnabled } from "./lifecycle";
import { createLogger } from "@/lib/logger";

const log = createLogger("metaapi.backfill");

/**
 * V2-B (#96): one-time year backfill on first link.
 *
 * Pulled ONCE into the candle warehouse; every later visit reads our own
 * table and gap-fixes the tail, so the expensive history never re-downloads.
 * Fire-and-forget from the connect flow — a backfill failure never fails
 * the link; the warehouse's existing gap-fix picks up whatever is missing.
 */

const BACKFILL_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;
const DEFAULT_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD"];
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Pure: month-sized chunks covering [from, to], oldest first. */
export function monthChunks(fromMs: number, toMs: number): Array<{ from: number; to: number }> {
  const MONTH = 30 * 24 * 60 * 60 * 1000;
  const chunks: Array<{ from: number; to: number }> = [];
  for (let start = fromMs; start < toMs; start += MONTH) {
    chunks.push({ from: start, to: Math.min(start + MONTH, toMs) });
  }
  return chunks;
}

const TF_TO_METAAPI: Record<(typeof BACKFILL_TIMEFRAMES)[number], string> = {
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

interface MetaApiCandle {
  time: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
}

export async function backfillYearForUser(
  userId: number,
  metaapiAccountId: string,
  symbols: string[] = DEFAULT_SYMBOLS,
): Promise<void> {
  if (!(await metaapiUxEnabled())) return;
  const now = Date.now();
  const from = now - YEAR_MS;
  log.info("start", { userId, symbols: symbols.length });

  for (const symbol of symbols) {
    for (const tf of BACKFILL_TIMEFRAMES) {
      try {
        await backfillSeries(userId, metaapiAccountId, symbol, tf, from, now);
      } catch (e) {
        log.warn("series.failed", {
          symbol,
          tf,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  log.info("done", { userId });
}

async function backfillSeries(
  userId: number,
  metaapiAccountId: string,
  symbol: string,
  tf: (typeof BACKFILL_TIMEFRAMES)[number],
  fromMs: number,
  toMs: number,
): Promise<void> {
  const connection = await getRpcConnection(userId, metaapiAccountId);
  const rpc = connection as unknown as {
    getHistoricalCandles?: (
      symbol: string,
      timeframe: string,
      startTime?: Date,
      limit?: number,
    ) => Promise<MetaApiCandle[]>;
  };
  if (typeof rpc.getHistoricalCandles !== "function") {
    log.warn("history_api_unavailable", { symbol, tf });
    return;
  }

  for (const chunk of monthChunks(fromMs, toMs)) {
    const raw = await rpc.getHistoricalCandles(
      symbol,
      TF_TO_METAAPI[tf],
      new Date(chunk.to),
      1000,
    );
    if (!raw?.length) continue;
    const candles = raw.map((c) => ({
      time: Math.floor(new Date(c.time).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.tickVolume ?? 0,
      complete: true,
    }));
    await upsertCandles(symbol, tf, candles);
  }
}
