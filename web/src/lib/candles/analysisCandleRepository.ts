/**
 * Analysis-only candle store — OANDA-sourced rows in the SAME `market_candles`
 * table as the chart's warehouse, under `source='oanda'`, but reached through
 * a COMPLETELY SEPARATE set of functions from `candleRepository.ts`.
 *
 * Why a separate module instead of an optional `source` parameter on
 * `candleRepository.ts`'s existing exports: those functions are called
 * directly (not through `fetchOhlc`) by code that does real order math, not
 * just pixels — `agent/orchestrator.ts` (ATR reachability grading),
 * `recommendations/recommendationTracker.ts` (stop/target-hit detection on
 * open recommendations), `agent/marketContext/*`, `marketMemory/*`, and of
 * course the visual chart's own read path (`warehouseOhlc.ts`). An optional
 * parameter is a convention every future caller and every future refactor
 * has to keep honoring correctly forever, and a slip is silent (wrong
 * numbers, not an error). A separate module makes the failure mode
 * structurally impossible instead: this file's exports are simply absent
 * from any of those call graphs. `__tests__/analysisIsolation.test.ts`
 * enforces that permanently — it fails the build if any of them ever import
 * this file or `@/lib/markets/oanda.ts`.
 *
 * This module's own callers must ALSO never be: the chart, Lonora's live
 * decision path, or anything the user sees as "their own broker's price."
 * Legitimate callers are `oandaBackfillService.ts` (writer), Quant Agent's
 * cron-context candle fetch, the backtest engine's coverage-gap fallback,
 * and the analysis-only MCP tools named in the plan.
 */
import { execute, query, queryOne } from "@/lib/db";
import {
  CANDLE_RETENTION_MS,
  MAX_READ_LIMIT,
  detectCandleGaps,
  sanitizeCandles,
  toStoredCandle,
  warehouseKey,
  type CandleRow,
  type StoredCandle,
  type WarehouseCoverage,
} from "./candleRepository";

export { detectCandleGaps };

/** The provenance tag every function in this file exclusively reads/writes. */
export const ANALYSIS_SOURCE = "oanda";

const UPSERT_CHUNK = 100;

/**
 * Read analysis-only (OANDA-sourced) candles. Same read shape as
 * `candleRepository.getCandles`, but can NEVER return a `source='metaapi'`
 * row — the SQL below hardcodes `ANALYSIS_SOURCE`, not a caller-supplied value.
 */
export async function getAnalysisCandles(params: {
  symbol: string;
  interval: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  order?: "asc" | "desc";
}): Promise<StoredCandle[]> {
  const { symbol, interval } = warehouseKey(params.symbol, params.interval);
  const limit = Math.min(Math.max(1, params.limit ?? 1000), MAX_READ_LIMIT);
  const order = params.order === "asc" ? "asc" : "desc";

  const conditions = ["symbol = ?", "interval = ?", "source = ?"];
  const args: unknown[] = [symbol, interval, ANALYSIS_SOURCE];
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
      ORDER BY time ${order === "asc" ? "ASC" : "DESC"}
      LIMIT ?`,
    args,
  );
  const candles = rows.map(toStoredCandle);
  return order === "asc" ? candles : candles.reverse();
}

export async function getAnalysisCoverage(params: {
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
    [symbol, interval, ANALYSIS_SOURCE],
  );
  return {
    firstTime: row?.first_time != null ? Number(row.first_time) : null,
    lastTime: row?.last_time != null ? Number(row.last_time) : null,
    count: Number(row?.count ?? 0),
  };
}

export async function countAnalysisCandlesInRange(params: {
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
    [symbol, interval, ANALYSIS_SOURCE, Math.floor(params.fromMs), Math.floor(params.toMs)],
  );
  return Number(row?.count ?? 0);
}

/** Idempotent batch upsert — always writes `source=ANALYSIS_SOURCE`, never caller-controlled. */
export async function upsertAnalysisCandles(
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
  const valid = sanitizeCandles(candles).candles;
  if (!valid.length) return 0;

  let written = 0;
  for (let i = 0; i < valid.length; i += UPSERT_CHUNK) {
    const chunk = valid.slice(i, i + UPSERT_CHUNK);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
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
        ANALYSIS_SOURCE,
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

export async function pruneExpiredAnalysisCandles(nowMs = Date.now()): Promise<number> {
  let deleted = 0;
  for (const [interval, retentionMs] of Object.entries(CANDLE_RETENTION_MS)) {
    const res = await execute(
      `DELETE FROM market_candles
        WHERE interval = ? AND source = ? AND time < ?`,
      [interval, ANALYSIS_SOURCE, nowMs - retentionMs],
    );
    deleted += res.changes;
  }
  return deleted;
}
