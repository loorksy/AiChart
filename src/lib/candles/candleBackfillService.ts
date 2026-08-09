/**
 * Candle backfill — the ONLY writer into the warehouse.
 *
 * The upstream is a linked MetaTrader account (via MetaApi): the requesting
 * user's own account when they have one, otherwise a feeder account — any
 * linked cloud account on the platform — so scheduled maintenance can still
 * run. A user request never performs a huge historical backfill inline: it
 * reads what the warehouse has and fires `triggerBackfill` (fire-and-forget)
 * to top up in the background. Concurrency is guarded twice: an in-process
 * Set dedupes within one instance, and a DB lease lock (locks table) dedupes
 * across web replicas / the worker so two processes never hammer the broker
 * history API for the same range.
 */
import { barDurationMs } from "@/lib/intervals";
import { acquireLock, releaseLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import { fetchMetaApiOhlcRange, isCandleComplete } from "@/lib/ohlc/metaApiOhlc";
import { targetHistoryStartMs } from "./candleHistoryPolicy";
import {
  detectCandleGaps,
  getCandles,
  getCoverage,
  upsertCandles,
  type CandleGap,
} from "./candleRepository";

const log = createLogger("candles:backfill");

/** Same-instance in-flight guard (cheap, avoids the DB round-trip on dupes). */
const activeBackfills = new Set<string>();
/** DB lease TTL — long enough for a paged history pull + write. */
const LOCK_TTL_MS = 30_000;
export const MAX_BACKFILL = 5000;
const HISTORICAL_PAGE_BARS = 4_500;

export interface BackfillParams {
  symbol: string;
  interval: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  /**
   * The linked account whose broker serves this pull. Absent (cron, sweeps),
   * a feeder account is picked from the linked pool; with none linked
   * anywhere the backfill reports `no_account` instead of inventing data.
   */
  feederUserId?: number;
  /**
   * Cap on history pages for THIS pull. Unset means the range fetcher's own
   * ceiling (10 pages at 12s each) — right for the cron, ruinous inside a
   * request: a cold series would spend up to two minutes against a stage
   * deadline of ten seconds, fail for certain, and leave the abandoned pages
   * running. Request paths pass 1 and leave the depth to the cron.
   */
  maxPages?: number;
}

export interface BackfillResult {
  inserted: number;
  skipped: boolean;
  reason?: "in_flight" | "locked" | "provider_error" | "no_account";
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
 * A linked cloud account that can serve history pulls when the caller has
 * none of its own (scheduled maintenance). Most recently updated first — the
 * account most likely to be deployed and synchronized right now.
 */
export async function pickWarehouseFeederUserId(): Promise<number | null> {
  const { queryOne } = await import("@/lib/db");
  const row = await queryOne<{ user_id: number }>(
    `SELECT user_id FROM mt_accounts
      WHERE metaapi_account_id IS NOT NULL AND metaapi_account_id != 'mt5local'
      ORDER BY updated_at DESC LIMIT 1`,
    [],
  ).catch(() => null);
  return row?.user_id ?? null;
}

async function resolveFeeder(params: BackfillParams): Promise<number | null> {
  if (params.feederUserId && params.feederUserId > 0) return params.feederUserId;
  return pickWarehouseFeederUserId();
}

/**
 * Synchronous-awaitable backfill. Pulls the requested window from a linked
 * MetaTrader account and upserts it. Double-guarded (in-process Set + DB
 * lease). Safe to await when a request genuinely needs the data now (small
 * windows only).
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

    const feeder = await resolveFeeder(params);
    if (!feeder) {
      return { inserted: 0, skipped: true, reason: "no_account" };
    }

    // The warehouse is keyed by CANONICAL symbol; the account answers to its
    // broker's spelling. Resolve through the catalogue, pull, store canonical.
    const { resolveBrokerSymbol } = await import("@/lib/markets/symbolCatalogue");
    const brokerSymbol = await resolveBrokerSymbol(feeder, symbol);

    const step = barDurationMs(interval);
    const toMs = params.toMs ?? Date.now();
    const fromMs = params.fromMs ?? toMs - count * step;
    const { candles, warning } = await fetchMetaApiOhlcRange(
      feeder,
      brokerSymbol,
      interval,
      { fromMs, toMs, ...(params.maxPages ? { maxPages: params.maxPages } : {}) },
    );

    if (!candles.length) {
      if (warning) {
        log.warn("backfill empty", { symbol, interval, warning });
        return { inserted: 0, skipped: true, reason: "provider_error" };
      }
      return { inserted: 0, skipped: false };
    }

    const inserted = await upsertCandles(
      symbol,
      interval,
      candles.map((c) => ({
        ...c,
        volume: c.volume ?? 0,
        complete: isCandleComplete(c.time, interval),
      })),
    );
    log.debug("backfilled", { symbol, interval, inserted });
    return { inserted, skipped: false };
  } catch (error) {
    log.error("backfill failed", {
      symbol: params.symbol,
      interval: params.interval,
      error: error instanceof Error ? error.message : String(error),
    });
    return { inserted: 0, skipped: true, reason: "provider_error" };
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
 * Page backward through broker history without ever asking the provider for
 * more than a bounded window. Callers choose a small maxPages and can resume
 * from `nextBeforeMs`; the scheduled maintainer naturally resumes from
 * MIN(time).
 */
export async function syncHistoricalCandles(input: {
  symbol: string;
  interval: string;
  fromMs: number;
  toMs?: number;
  maxPages?: number;
  feederUserId?: number;
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
      feederUserId: input.feederUserId,
    });
    pages += 1;
    inserted += result.inserted;
    if (result.reason === "provider_error" || result.reason === "no_account") {
      errors.push(
        `history pull failed for ${new Date(pageFrom).toISOString()}..${new Date(beforeMs).toISOString()}`,
      );
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
  feederUserId?: number;
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
      feederUserId: input.feederUserId,
    });
    if (result.reason === "provider_error" || result.reason === "no_account") {
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

function historicalPagesPerRun(): number {
  const configured = Number(process.env.CANDLE_SYNC_MAX_PAGES ?? "5");
  return Number.isFinite(configured)
    ? Math.min(Math.max(Math.floor(configured), 1), 20)
    : 5;
}

/** One bounded maintenance unit suitable for cron/worker execution. */
export async function maintainCandleSeries(input: {
  symbol: string;
  interval: string;
  nowMs?: number;
  feederUserId?: number;
}): Promise<CandleMaintenanceResult> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const nowMs = input.nowMs ?? Date.now();
  const initialCoverage = await getCoverage({ symbol, interval });
  const latest = await backfillCandles({
    symbol,
    interval,
    limit: initialCoverage.count === 0 ? MAX_BACKFILL : 10,
    feederUserId: input.feederUserId,
  });
  const afterLatest = await getCoverage({ symbol, interval });
  const targetStart = targetHistoryStartMs(interval, nowMs);
  let historicalInserted = 0;
  const errors: string[] = [];

  if (
    afterLatest.firstTime == null ||
    afterLatest.firstTime > targetStart
  ) {
    const historical = await syncHistoricalCandles({
      symbol,
      interval,
      fromMs: targetStart,
      toMs:
        afterLatest.firstTime != null
          ? afterLatest.firstTime - 1
          : nowMs,
      maxPages: historicalPagesPerRun(),
      feederUserId: input.feederUserId,
    });
    historicalInserted = historical.inserted;
    errors.push(...historical.errors);
  }

  const gapRepair = await repairRecentCandleGaps({
    symbol,
    interval,
    feederUserId: input.feederUserId,
  });
  errors.push(...gapRepair.errors);
  if (latest.reason === "provider_error") errors.unshift("latest broker refresh failed");
  if (latest.reason === "no_account") errors.unshift("no linked account can feed the warehouse");
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
