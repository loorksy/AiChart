/**
 * Candle Warehouse repository — AiChart's own server-side candle store.
 *
 * OANDA is the upstream provider, not the per-request data source: charts and
 * agents read from `market_candles` first; the backfill service tops the table
 * up from OANDA when coverage is missing or stale. Times are candle-open in
 * MILLISECONDS (matching the OANDA adapter); the API layer converts to chart
 * seconds at the boundary like every other candle path.
 */
import { execute, query, queryOne } from "@/lib/db";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";

export interface StoredCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  complete: boolean;
}

export interface WarehouseCoverage {
  firstTime: number | null;
  lastTime: number | null;
  count: number;
}

export const WAREHOUSE_SOURCE = "oanda";
const MAX_READ_LIMIT = 10_000;
/** ~100 rows × 10 params stays far under SQLite's bind-variable ceiling. */
const UPSERT_CHUNK = 100;

interface CandleRow {
  time: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string | null;
  complete: number | boolean | null;
}

/** pg returns BIGINT/COUNT as strings and BOOLEAN as 1/0 via normalizeRow — coerce all. */
function toStoredCandle(row: CandleRow): StoredCandle {
  return {
    time: Number(row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? 0),
    complete: Boolean(Number(row.complete ?? 1)),
  };
}

export function warehouseKey(symbol: string, interval: string): {
  symbol: string;
  interval: string;
} {
  return {
    symbol: forexCanonicalKey(symbol),
    interval: normalizeCanonicalInterval(interval),
  };
}

/**
 * Read candles ascending by time. `fromMs`/`toMs` are inclusive bounds; with
 * no bounds the newest `limit` candles are returned.
 */
export async function getCandles(params: {
  symbol: string;
  interval: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}): Promise<StoredCandle[]> {
  const { symbol, interval } = warehouseKey(params.symbol, params.interval);
  const limit = Math.min(Math.max(1, params.limit ?? 1000), MAX_READ_LIMIT);

  const conditions = ["symbol = ?", "interval = ?", "source = ?"];
  const args: unknown[] = [symbol, interval, WAREHOUSE_SOURCE];
  if (params.fromMs != null && Number.isFinite(params.fromMs)) {
    conditions.push("time >= ?");
    args.push(Math.floor(params.fromMs));
  }
  if (params.toMs != null && Number.isFinite(params.toMs)) {
    conditions.push("time <= ?");
    args.push(Math.floor(params.toMs));
  }
  args.push(limit);

  const rows = await query<CandleRow>(
    `SELECT time, open, high, low, close, volume, complete
       FROM market_candles
      WHERE ${conditions.join(" AND ")}
      ORDER BY time DESC
      LIMIT ?`,
    args,
  );
  return rows.map(toStoredCandle).reverse();
}

/**
 * Idempotent batch upsert. The forming candle is re-upserted on every refresh
 * until OANDA marks it complete, so re-ingesting a window is always safe.
 * Returns the number of rows written.
 */
export async function upsertCandles(
  symbol: string,
  interval: string,
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    complete?: boolean;
  }>,
): Promise<number> {
  const key = warehouseKey(symbol, interval);
  const valid = candles.filter(
    (c) =>
      Number.isFinite(c.time) &&
      c.time > 0 &&
      [c.open, c.high, c.low, c.close].every(
        (p) => Number.isFinite(p) && p > 0,
      ),
  );
  if (!valid.length) return 0;

  let written = 0;
  for (let i = 0; i < valid.length; i += UPSERT_CHUNK) {
    const chunk = valid.slice(i, i + UPSERT_CHUNK);
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ");
    const args: unknown[] = [];
    for (const c of chunk) {
      args.push(
        key.symbol,
        key.interval,
        Math.floor(c.time),
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume ?? 0,
        WAREHOUSE_SOURCE,
        c.complete === false ? 0 : 1,
      );
    }
    const res = await execute(
      `INSERT INTO market_candles
         (symbol, interval, time, open, high, low, close, volume, source, complete)
       VALUES ${placeholders}
       ON CONFLICT (symbol, interval, time, source) DO UPDATE SET
         open = excluded.open,
         high = excluded.high,
         low = excluded.low,
         close = excluded.close,
         volume = excluded.volume,
         complete = excluded.complete,
         updated_at = datetime('now')`,
      args,
    );
    written += res.changes;
  }
  return written;
}

/** Stored range + row count for a symbol/interval (times in ms). */
export async function getCoverage(params: {
  symbol: string;
  interval: string;
}): Promise<WarehouseCoverage> {
  const { symbol, interval } = warehouseKey(params.symbol, params.interval);
  const row = await queryOne<{
    first_time: number | string | null;
    last_time: number | string | null;
    count: number | string;
  }>(
    `SELECT MIN(time) AS first_time, MAX(time) AS last_time, COUNT(*) AS count
       FROM market_candles
      WHERE symbol = ? AND interval = ? AND source = ?`,
    [symbol, interval, WAREHOUSE_SOURCE],
  );
  return {
    firstTime: row?.first_time != null ? Number(row.first_time) : null,
    lastTime: row?.last_time != null ? Number(row.last_time) : null,
    count: Number(row?.count ?? 0),
  };
}

/** Rows stored inside [fromMs, toMs] — cheap gap heuristic for range requests. */
export async function countCandlesInRange(params: {
  symbol: string;
  interval: string;
  fromMs: number;
  toMs: number;
}): Promise<number> {
  const { symbol, interval } = warehouseKey(params.symbol, params.interval);
  const row = await queryOne<{ count: number | string }>(
    `SELECT COUNT(*) AS count
       FROM market_candles
      WHERE symbol = ? AND interval = ? AND source = ?
        AND time >= ? AND time <= ?`,
    [
      symbol,
      interval,
      WAREHOUSE_SOURCE,
      Math.floor(params.fromMs),
      Math.floor(params.toMs),
    ],
  );
  return Number(row?.count ?? 0);
}

/**
 * Retention policy (cleanup job): 1m candles kept ~2 years, 5m/15m ~5 years,
 * 1h+ kept indefinitely. Returns deleted row count.
 */
export const CANDLE_RETENTION_MS: Record<string, number> = {
  "1m": 2 * 365 * 24 * 3600 * 1000,
  "5m": 5 * 365 * 24 * 3600 * 1000,
  "15m": 5 * 365 * 24 * 3600 * 1000,
};

export async function pruneExpiredCandles(): Promise<number> {
  let deleted = 0;
  for (const [interval, retentionMs] of Object.entries(CANDLE_RETENTION_MS)) {
    const res = await execute(
      `DELETE FROM market_candles
        WHERE interval = ? AND source = ? AND time < ?`,
      [interval, WAREHOUSE_SOURCE, Date.now() - retentionMs],
    );
    deleted += res.changes;
  }
  return deleted;
}
