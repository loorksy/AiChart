/**
 * Candle backfill — the ONLY writer into the warehouse from OANDA.
 *
 * A user request never performs a huge historical backfill inline: it reads
 * what the warehouse has and fires `triggerBackfill` (fire-and-forget) to top
 * up in the background. Concurrency is guarded twice: an in-process Set dedupes
 * within one instance, and a DB lease lock (locks table) dedupes across web
 * replicas / the worker so two processes never hammer OANDA for the same range.
 */
import { fetchOandaCandles } from "@/lib/markets/oanda";
import { barDurationMs } from "@/lib/intervals";
import { acquireLock, releaseLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import {
  CANDLE_RETENTION_MS,
  detectCandleGaps,
  getCandles,
  getCoverage,
  upsertCandles,
  type CandleGap,
} from "./candleRepository";

const log = createLogger("candles:backfill");

/** Same-instance in-flight guard (cheap, avoids the DB round-trip on dupes). */
const activeBackfills = new Set<string>();
/** DB lease TTL — long enough for a 5000-candle OANDA page + write. */
const LOCK_TTL_MS = 30_000;
const MAX_BACKFILL = 5000;
const HISTORICAL_PAGE_BARS = 4_500;

export interface BackfillParams {
  symbol: string;
  interval: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export interface BackfillResult {
  inserted: number;
  skipped: boolean;
  reason?: "in_flight" | "locked" | "oanda_error";
}

export interface HistoricalSyncResult {
  symbol: string;
  interval: string;
  pages: number;
  inserted: number;
  reachedStart: boolean;
  nextBeforeMs: number | null;
  errors: string[];
}

export interface CandleMaintenanceResult {
  symbol: string;
  interval: string;
  latestInserted: number;
  historicalInserted: number;
  repairedGaps: number;
  remainingGaps: CandleGap[];
  coverage: Awaited<ReturnType<typeof getCoverage>>;
  errors: string[];
}

function backfillKey(p: BackfillParams): string {
  const symbol = forexCanonicalKey(p.symbol);
  const interval = normalizeCanonicalInterval(p.interval);
  return `candle-backfill:${symbol}:${interval}:${p.fromMs ?? "none"}:${p.toMs ?? "none"}`;
}

/**
 * Synchronous-awaitable backfill. Pulls the requested window from OANDA and
 * upserts it. Double-guarded (in-process Set + DB lease). Safe to await when a
 * request genuinely needs the data now (small windows only).
 */
export async function backfillCandles(
  params: BackfillParams,
): Promise<BackfillResult> {
  const key = backfillKey(params);
  if (activeBackfills.has(key)) {
    return { inserted: 0, skipped: true, reason: "in_flight" };
  }
  activeBackfills.add(key);

  // Cross-instance lease: if another replica/worker holds it, skip quietly.
  const lock = await acquireLock(key, LOCK_TTL_MS).catch(() => null);
  if (!lock) {
    activeBackfills.delete(key);
    return { inserted: 0, skipped: true, reason: "locked" };
  }

  try {
    const symbol = forexCanonicalKey(params.symbol);
    const interval = normalizeCanonicalInterval(params.interval);
    const count = Math.min(params.limit ?? MAX_BACKFILL, MAX_BACKFILL);

    const { candles } = await fetchOandaCandles(symbol, interval, count, {
      fromMs: params.fromMs,
      toMs: params.toMs,
    });

    if (!candles.length) {
      return { inserted: 0, skipped: false };
    }

    const inserted = await upsertCandles(symbol, interval, candles);
    log.debug("backfilled", { symbol, interval, inserted });
    return { inserted, skipped: false };
  } catch (error) {
    log.error("backfill failed", {
      symbol: params.symbol,
      interval: params.interval,
      error: error instanceof Error ? error.message : String(error),
    });
    return { inserted: 0, skipped: true, reason: "oanda_error" };
  } finally {
    await releaseLock(lock).catch(() => {});
    activeBackfills.delete(key);
  }
}

/** Fire-and-forget backfill — never blocks the caller, swallows failures. */
export function triggerBackfill(params: BackfillParams): void {
  void backfillCandles(params).catch((error) => {
    log.error("triggerBackfill rejected", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Page backward through OANDA without ever asking the provider for more than a
 * bounded window. Callers choose a small maxPages and can resume from
 * `nextBeforeMs`; the scheduled maintainer naturally resumes from MIN(time).
 */
export async function syncHistoricalCandles(input: {
  symbol: string;
  interval: string;
  fromMs: number;
  toMs?: number;
  maxPages?: number;
}): Promise<HistoricalSyncResult> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const step = barDurationMs(interval);
  const fromMs = Math.floor(input.fromMs);
  let beforeMs = Math.floor(input.toMs ?? Date.now());
  const maxPages = Math.min(Math.max(input.maxPages ?? 1, 1), 20);
  let pages = 0;
  let inserted = 0;
  const errors: string[] = [];

  while (pages < maxPages && beforeMs > fromMs) {
    const pageFrom = Math.max(fromMs, beforeMs - HISTORICAL_PAGE_BARS * step);
    const result = await backfillCandles({
      symbol,
      interval,
      fromMs: pageFrom,
      toMs: beforeMs,
      limit: HISTORICAL_PAGE_BARS,
    });
    pages += 1;
    inserted += result.inserted;
    if (result.reason === "oanda_error") {
      errors.push(`OANDA failed for ${new Date(pageFrom).toISOString()}..${new Date(beforeMs).toISOString()}`);
      break;
    }
    if (result.reason === "locked" || result.reason === "in_flight") break;
    beforeMs = pageFrom - 1;
  }

  return {
    symbol,
    interval,
    pages,
    inserted,
    reachedStart: beforeMs <= fromMs,
    nextBeforeMs: beforeMs > fromMs ? beforeMs : null,
    errors,
  };
}

/** Detect and repair bounded gaps in the most recent stored window. */
export async function repairRecentCandleGaps(input: {
  symbol: string;
  interval: string;
  limit?: number;
  maxGaps?: number;
}): Promise<{ repaired: number; remaining: CandleGap[]; errors: string[] }> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const step = barDurationMs(interval);
  const rows = await getCandles({
    symbol,
    interval,
    limit: Math.min(Math.max(input.limit ?? 10_000, 100), 10_000),
  });
  const gaps = detectCandleGaps(symbol, interval, rows);
  const maxGaps = Math.min(Math.max(input.maxGaps ?? 4, 0), 20);
  let repaired = 0;
  const errors: string[] = [];

  for (const gap of gaps.slice(0, maxGaps)) {
    const result = await backfillCandles({
      symbol,
      interval,
      fromMs: Math.max(1, gap.fromMs - step),
      toMs: gap.toMs + step,
      limit: Math.min(gap.missingBars + 4, MAX_BACKFILL),
    });
    if (result.reason === "oanda_error") {
      errors.push(`gap repair failed at ${new Date(gap.fromMs).toISOString()}`);
    } else if (!result.skipped) {
      repaired += 1;
    }
  }

  const after = await getCandles({ symbol, interval, limit: 10_000 });
  return {
    repaired,
    remaining: detectCandleGaps(symbol, interval, after),
    errors,
  };
}

function historyStartMs(interval: string, nowMs: number): number {
  const configuredYears = Number(process.env.CANDLE_HISTORY_YEARS ?? "5");
  const years = Number.isFinite(configuredYears)
    ? Math.min(Math.max(configuredYears, 1), 10)
    : 5;
  const desired = years * 365.25 * 24 * 60 * 60 * 1000;
  const retention = CANDLE_RETENTION_MS[interval];
  return nowMs - Math.min(desired, retention ?? desired);
}

/** One bounded maintenance unit suitable for cron/worker execution. */
export async function maintainCandleSeries(input: {
  symbol: string;
  interval: string;
  nowMs?: number;
}): Promise<CandleMaintenanceResult> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const nowMs = input.nowMs ?? Date.now();
  const initialCoverage = await getCoverage({ symbol, interval });
  const latest = await backfillCandles({
    symbol,
    interval,
    limit: initialCoverage.count === 0 ? MAX_BACKFILL : 10,
  });
  const afterLatest = await getCoverage({ symbol, interval });
  const targetStart = historyStartMs(interval, nowMs);
  let historicalInserted = 0;
  const errors: string[] = [];

  if (afterLatest.firstTime != null && afterLatest.firstTime > targetStart) {
    const historical = await syncHistoricalCandles({
      symbol,
      interval,
      fromMs: targetStart,
      toMs: afterLatest.firstTime - 1,
      maxPages: 1,
    });
    historicalInserted = historical.inserted;
    errors.push(...historical.errors);
  }

  const gapRepair = await repairRecentCandleGaps({ symbol, interval });
  errors.push(...gapRepair.errors);
  if (latest.reason === "oanda_error") errors.unshift("latest OANDA refresh failed");
  return {
    symbol,
    interval,
    latestInserted: latest.inserted,
    historicalInserted,
    repairedGaps: gapRepair.repaired,
    remainingGaps: gapRepair.remaining.slice(0, 20),
    coverage: await getCoverage({ symbol, interval }),
    errors,
  };
}
