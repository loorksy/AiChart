/**
 * The gold candle store.
 *
 * A backtest needs bars, and OANDA is a rate-limited API rather than a
 * database. Re-fetching five years of 15m candles for every strategy run is
 * exactly how "lightning backtests" become an overnight job — and the 100-trade
 * evidence bar that G5 enforces needs years of history on intraday frames, not
 * the few hundred bars a live request carries.
 *
 * So closed bars are kept once and read many times.
 *
 * Three properties are load-bearing:
 *
 *  1. **Closed bars only.** A forming candle's high and low are still moving. A
 *     backtest that read one would be trading a bar the market had not finished
 *     printing, and its win rate would be a measurement of the future.
 *  2. **One instrument.** There is no symbol column, on purpose: this platform
 *     trades gold, and a symbol column is an invitation to store a second
 *     instrument — the exact drift gold-only exists to prevent.
 *  3. **Idempotent writes.** Backfill windows overlap by design (a boundary bar
 *     appears in both pages), so writing the same bar twice must be a no-op
 *     rather than a duplicate or a conflict.
 *
 * This is NOT a live-data path. Nothing in the request path reads it; the
 * market pipeline still goes straight to OANDA, and re-introducing a cache
 * there is what the earlier migration deliberately removed.
 */
import { execute, query, queryOne } from "@/lib/db";
import { barDurationMs } from "@/lib/intervals";
import { isCandleComplete } from "@/lib/ohlc/candleTime";
import { fetchOandaCandles } from "@/lib/markets/oanda";
import { createLogger } from "@/lib/logger";
import { DATA_SYMBOL, TIMEFRAMES } from "@/lib/gold";

const log = createLogger("gold.candle-store");

/**
 * Frames the store keeps: the analysis frames plus the daily above them. `1d`
 * earns its place because a 4h strategy's context is daily, and re-deriving it
 * by aggregation would put a second definition of "a day" in the codebase.
 */
export const STORED_TIMEFRAMES: readonly string[] = [...TIMEFRAMES, "1d"];

/** Bars per OANDA page. Their hard ceiling is 5000; this leaves headroom. */
const PAGE_SIZE = 4_500;

/** A backfill pass will not walk further back than this in one run. */
export const MAX_BACKFILL_PAGES = 12;

export interface StoredGoldCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function assertStorable(timeframe: string): void {
  if (!STORED_TIMEFRAMES.includes(timeframe)) {
    throw new Error(`gold candle store does not keep ${timeframe}`);
  }
}

/**
 * A bar worth storing.
 *
 * Rejects the shapes that corrupt a backtest silently rather than loudly: a
 * non-positive price, a high below its own low, a close outside the bar's own
 * range. Each of those produces a trade the market could never have offered.
 */
function isSaneCandle(candle: Omit<StoredGoldCandle, "volume">): boolean {
  const { open, high, low, close } = candle;
  if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) return false;
  if (!Number.isSafeInteger(candle.time) || candle.time <= 0) return false;
  if (high < low) return false;
  if (open > high || open < low) return false;
  if (close > high || close < low) return false;
  return true;
}

/**
 * Write bars, ignoring any that already exist.
 *
 * Returns how many rows were actually new — the number a backfill loop needs to
 * know whether it is still making progress or spinning on a range it already
 * has.
 */
export async function storeGoldCandles(
  timeframe: string,
  // Volume is optional at the provider boundary and defaulted here, so callers
  // can hand over an OANDA page without reshaping it first.
  candles: readonly (Omit<StoredGoldCandle, "volume"> & { volume?: number })[],
): Promise<number> {
  assertStorable(timeframe);
  let written = 0;
  for (const candle of candles) {
    if (!isSaneCandle(candle)) continue;
    if (!isCandleComplete(candle.time, timeframe)) continue;
    const result = await execute(
      `INSERT INTO gold_candles (timeframe, time, open, high, low, close, volume)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (timeframe, time) DO NOTHING`,
      [
        timeframe,
        candle.time,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        Math.max(0, Math.floor(candle.volume ?? 0)),
      ],
    );
    written += result.changes > 0 ? 1 : 0;
  }
  return written;
}

export interface GoldCandleRange {
  /** Oldest stored bar open time, or null when the frame is empty. */
  oldest: number | null;
  /** Newest stored bar open time, or null when the frame is empty. */
  newest: number | null;
  count: number;
}

export async function goldCandleRange(timeframe: string): Promise<GoldCandleRange> {
  assertStorable(timeframe);
  const row = await queryOne<{ oldest: number | null; newest: number | null; count: number }>(
    `SELECT MIN(time) AS oldest, MAX(time) AS newest, COUNT(*) AS count
       FROM gold_candles WHERE timeframe = ?`,
    [timeframe],
  ).catch(() => null);
  return {
    oldest: row?.oldest == null ? null : Number(row.oldest),
    newest: row?.newest == null ? null : Number(row.newest),
    count: Number(row?.count ?? 0),
  };
}

/** Stored bars, oldest first — the order every backtest loop expects. */
export async function readGoldCandles(input: {
  timeframe: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}): Promise<StoredGoldCandle[]> {
  assertStorable(input.timeframe);
  const limit = Math.max(1, Math.min(200_000, Math.floor(input.limit ?? 50_000)));
  const clauses = ["timeframe = ?"];
  const params: unknown[] = [input.timeframe];
  if (input.fromMs != null) {
    clauses.push("time >= ?");
    params.push(input.fromMs);
  }
  if (input.toMs != null) {
    clauses.push("time <= ?");
    params.push(input.toMs);
  }
  // Newest-first with a limit, then reversed: asking for "the last N bars" must
  // return the most RECENT N, and an oldest-first limit would hand back the
  // start of history instead.
  const rows = await query<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>(
    `SELECT time, open, high, low, close, volume
       FROM gold_candles
      WHERE ${clauses.join(" AND ")}
      ORDER BY time DESC
      LIMIT ?`,
    [...params, limit],
  ).catch(() => []);
  return rows
    .map((row) => ({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }))
    .reverse();
}

export interface BackfillResult {
  timeframe: string;
  written: number;
  pages: number;
  oldest: number | null;
  newest: number | null;
  /** Set when the pass stopped for a reason worth reporting. */
  stoppedBecause?: "no_more_history" | "page_limit" | "provider_empty";
}

/**
 * Extend one timeframe's history backwards from what is already stored.
 *
 * Walks backwards rather than forwards because the useful direction is deeper
 * history: the newest bars arrive on their own from the forward pass below,
 * while the 100-trade evidence bar is only reachable by going further back.
 *
 * Never throws. A provider failure ends the pass with what it managed to
 * write — a partial store is strictly better than none, and the next run
 * resumes from the new oldest bar.
 */
export async function backfillGoldCandles(input: {
  timeframe: string;
  maxPages?: number;
}): Promise<BackfillResult> {
  assertStorable(input.timeframe);
  const maxPages = Math.max(1, Math.min(MAX_BACKFILL_PAGES, input.maxPages ?? 4));
  const start = await goldCandleRange(input.timeframe);
  let cursor = start.oldest;
  let written = 0;
  let pages = 0;
  let stoppedBecause: BackfillResult["stoppedBecause"];

  while (pages < maxPages) {
    let batch;
    try {
      batch = await fetchOandaCandles(
        DATA_SYMBOL,
        input.timeframe,
        PAGE_SIZE,
        cursor == null ? undefined : { beforeMs: cursor },
      );
    } catch (error) {
      log.warn("backfill.provider_failed", {
        timeframe: input.timeframe,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
    pages += 1;
    if (!batch.candles.length) {
      stoppedBecause = "provider_empty";
      break;
    }

    const closed = batch.candles.filter((candle) => candle.complete);
    const added = await storeGoldCandles(input.timeframe, closed);
    written += added;

    const oldestInBatch = batch.candles[0]?.time ?? null;
    // No new rows AND no older bar than the cursor means the provider has run
    // out of history. Continuing would re-fetch the same page forever.
    if (added === 0 && (oldestInBatch == null || (cursor != null && oldestInBatch >= cursor))) {
      stoppedBecause = "no_more_history";
      break;
    }
    cursor = oldestInBatch;
    if (!batch.hasMore) {
      stoppedBecause = "no_more_history";
      break;
    }
  }
  if (!stoppedBecause && pages >= maxPages) stoppedBecause = "page_limit";

  const end = await goldCandleRange(input.timeframe);
  return {
    timeframe: input.timeframe,
    written,
    pages,
    oldest: end.oldest,
    newest: end.newest,
    stoppedBecause,
  };
}

/**
 * Bring one timeframe up to date with the bars that closed since the last run.
 *
 * Cheap by construction: it asks for just enough bars to cover the gap, so a
 * store that ran an hour ago fetches a handful rather than a page.
 */
export async function extendGoldCandles(timeframe: string): Promise<number> {
  assertStorable(timeframe);
  const { newest } = await goldCandleRange(timeframe);
  const barMs = barDurationMs(timeframe) || 60_000;
  const missing =
    newest == null ? PAGE_SIZE : Math.ceil((Date.now() - newest) / barMs) + 2;
  const count = Math.max(2, Math.min(PAGE_SIZE, missing));
  try {
    const batch = await fetchOandaCandles(DATA_SYMBOL, timeframe, count);
    return await storeGoldCandles(
      timeframe,
      batch.candles.filter((candle) => candle.complete),
    );
  } catch (error) {
    log.warn("extend.provider_failed", {
      timeframe,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export interface StoreSyncReport {
  extended: Record<string, number>;
  backfilled: BackfillResult[];
}

/**
 * One maintenance pass across every stored frame.
 *
 * Forward first, then backward: catching up to now is bounded and fast, while
 * digging into history is the open-ended half. Doing it in the other order
 * would leave the store's newest bars stale whenever the backfill ran long.
 */
export async function syncGoldCandleStore(options?: {
  backfillPages?: number;
}): Promise<StoreSyncReport> {
  const extended: Record<string, number> = {};
  for (const timeframe of STORED_TIMEFRAMES) {
    extended[timeframe] = await extendGoldCandles(timeframe);
  }
  const backfilled: BackfillResult[] = [];
  for (const timeframe of STORED_TIMEFRAMES) {
    backfilled.push(
      await backfillGoldCandles({ timeframe, maxPages: options?.backfillPages }),
    );
  }
  log.info("gold.store.synced", {
    extended,
    backfilled: backfilled.map((item) => ({
      timeframe: item.timeframe,
      written: item.written,
      stoppedBecause: item.stoppedBecause,
    })),
  });
  return { extended, backfilled };
}
