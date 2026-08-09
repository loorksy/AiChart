/**
 * OANDA analysis-only candle backfill — the ONLY writer into
 * `market_candles` under `source='oanda'` (via
 * `analysisCandleRepository.upsertAnalysisCandles`).
 *
 * Mirrors `candleBackfillService.ts`'s shape (same-instance in-process
 * dedup + a DB lease lock, then bounded historical paging + gap repair
 * wrapped into one maintenance unit for cron), but simpler: OANDA is one
 * platform-level credential (`OANDA_API_TOKEN`), not tied to any user, so
 * there is no "resolve a linked/feeder account" step at all — every caller
 * hits the same platform credential.
 *
 * Legitimate callers: the cron OANDA maintenance phase
 * (`api/cron/candle-warehouse/route.ts`) and the backtest engine's
 * coverage-gap fallback (`research/warehouse.ts`), fire-and-forget, when it
 * has just served a request from thin analysis coverage. NEVER the chart or
 * Lonora's live decision path — see `analysisCandleRepository.ts`'s header
 * comment for the isolation guarantee this depends on.
 */
import { barDurationMs } from "@/lib/intervals";
import { acquireLock, releaseLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import { fetchOandaCandles, oandaConfigured } from "@/lib/markets/oanda";
import {
  detectCandleGaps,
  getAnalysisCandles,
  getAnalysisCoverage,
  upsertAnalysisCandles,
} from "./analysisCandleRepository";
// `analysisCandleRepository.ts` re-exports the `detectCandleGaps` function
// but not its `CandleGap` return type — pull the type straight from where
// it's declared instead of widening that file's exports.
import type { CandleGap } from "./candleRepository";
import { targetHistoryStartMs } from "./candleHistoryPolicy";

const log = createLogger("candles:oanda-backfill");

/** Same-instance in-flight guard (cheap, avoids the DB round-trip on dupes). */
const activeBackfills = new Set<string>();
/** DB lease TTL — long enough for a single OANDA candles call + write. */
const LOCK_TTL_MS = 30_000;
export const MAX_ANALYSIS_BACKFILL = 5000;
const HISTORICAL_PAGE_BARS = 4_500;

export interface AnalysisBackfillParams {
  symbol: string;
  interval: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export interface AnalysisBackfillResult {
  inserted: number;
  skipped: boolean;
  reason?: "in_flight" | "locked" | "provider_error" | "not_configured";
}

export interface AnalysisHistoricalSyncResult {
  symbol: string;
  interval: string;
  pages: number;
  inserted: number;
  reachedStart: boolean;
  nextBeforeMs: number | null;
  errors: string[];
}

export interface AnalysisCandleMaintenanceResult {
  symbol: string;
  interval: string;
  latestInserted: number;
  historicalInserted: number;
  repairedGaps: number;
  remainingGaps: CandleGap[];
  coverage: Awaited<ReturnType<typeof getAnalysisCoverage>>;
  errors: string[];
}

function analysisBackfillKey(p: AnalysisBackfillParams): string {
  const symbol = forexCanonicalKey(p.symbol);
  const interval = normalizeCanonicalInterval(p.interval);
  return `oanda-analysis-backfill:${symbol}:${interval}:${p.fromMs ?? "none"}:${p.toMs ?? "none"}`;
}

/**
 * Synchronous-awaitable backfill. Pulls the requested window from OANDA and
 * upserts it under `source='oanda'`. Double-guarded (in-process Set + DB
 * lease), same as `candleBackfillService.backfillCandles` — but with no
 * feeder-account resolution step, since OANDA answers to one platform token.
 */
export async function backfillAnalysisCandles(
  params: AnalysisBackfillParams,
): Promise<AnalysisBackfillResult> {
  if (!oandaConfigured()) {
    return { inserted: 0, skipped: true, reason: "not_configured" };
  }

  const key = analysisBackfillKey(params);
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
    const count = Math.min(params.limit ?? MAX_ANALYSIS_BACKFILL, MAX_ANALYSIS_BACKFILL);

    const step = barDurationMs(interval);
    const toMs = params.toMs ?? Date.now();
    const fromMs = params.fromMs ?? toMs - count * step;

    const { candles } = await fetchOandaCandles(symbol, interval, count, { fromMs, toMs });
    if (!candles.length) {
      return { inserted: 0, skipped: false };
    }

    const inserted = await upsertAnalysisCandles(
      symbol,
      interval,
      candles.map((c) => ({ ...c, volume: c.volume ?? 0 })),
    );
    log.debug("analysis backfilled", { symbol, interval, inserted });
    return { inserted, skipped: false };
  } catch (error) {
    log.error("analysis backfill failed", {
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
export function triggerAnalysisBackfill(params: AnalysisBackfillParams): void {
  void backfillAnalysisCandles(params).catch((error) => {
    log.error("triggerAnalysisBackfill rejected", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Page backward through OANDA history without ever asking for more than a
 * bounded window per call (`fetchOandaCandles` itself clamps a single
 * from/to pull to ~4800 bars). Callers choose a small maxPages and can
 * resume from `nextBeforeMs`; the scheduled maintainer naturally resumes
 * from MIN(time).
 */
export async function syncHistoricalAnalysisCandles(input: {
  symbol: string;
  interval: string;
  fromMs: number;
  toMs?: number;
  maxPages?: number;
}): Promise<AnalysisHistoricalSyncResult> {
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
    const result = await backfillAnalysisCandles({
      symbol,
      interval,
      fromMs: pageFrom,
      toMs: beforeMs,
      limit: HISTORICAL_PAGE_BARS,
    });
    pages += 1;
    inserted += result.inserted;
    if (result.reason === "provider_error" || result.reason === "not_configured") {
      errors.push(
        `analysis history pull failed for ${new Date(pageFrom).toISOString()}..${new Date(beforeMs).toISOString()}`,
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

/** Detect and repair bounded gaps in the most recent stored analysis window. */
export async function repairRecentAnalysisCandleGaps(input: {
  symbol: string;
  interval: string;
  limit?: number;
  maxGaps?: number;
}): Promise<{ repaired: number; remaining: CandleGap[]; errors: string[] }> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const step = barDurationMs(interval);
  const rows = await getAnalysisCandles({
    symbol,
    interval,
    limit: Math.min(Math.max(input.limit ?? 10_000, 100), 10_000),
  });
  const gaps = detectCandleGaps(symbol, interval, rows);
  const maxGaps = Math.min(Math.max(input.maxGaps ?? 4, 0), 20);
  let repaired = 0;
  const errors: string[] = [];

  for (const gap of gaps.slice(0, maxGaps)) {
    const result = await backfillAnalysisCandles({
      symbol,
      interval,
      fromMs: Math.max(1, gap.fromMs - step),
      toMs: gap.toMs + step,
      limit: Math.min(gap.missingBars + 4, MAX_ANALYSIS_BACKFILL),
    });
    if (result.reason === "provider_error" || result.reason === "not_configured") {
      errors.push(`analysis gap repair failed at ${new Date(gap.fromMs).toISOString()}`);
    } else if (!result.skipped) {
      repaired += 1;
    }
  }

  const after = await getAnalysisCandles({ symbol, interval, limit: 10_000 });
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
export async function maintainAnalysisCandleSeries(input: {
  symbol: string;
  interval: string;
  nowMs?: number;
}): Promise<AnalysisCandleMaintenanceResult> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const nowMs = input.nowMs ?? Date.now();
  const initialCoverage = await getAnalysisCoverage({ symbol, interval });
  const latest = await backfillAnalysisCandles({
    symbol,
    interval,
    limit: initialCoverage.count === 0 ? MAX_ANALYSIS_BACKFILL : 10,
  });
  const afterLatest = await getAnalysisCoverage({ symbol, interval });
  const targetStart = targetHistoryStartMs(interval, nowMs);
  let historicalInserted = 0;
  const errors: string[] = [];

  if (afterLatest.firstTime == null || afterLatest.firstTime > targetStart) {
    const historical = await syncHistoricalAnalysisCandles({
      symbol,
      interval,
      fromMs: targetStart,
      toMs: afterLatest.firstTime != null ? afterLatest.firstTime - 1 : nowMs,
      maxPages: historicalPagesPerRun(),
    });
    historicalInserted = historical.inserted;
    errors.push(...historical.errors);
  }

  const gapRepair = await repairRecentAnalysisCandleGaps({ symbol, interval });
  errors.push(...gapRepair.errors);
  if (latest.reason === "provider_error") errors.unshift("latest OANDA refresh failed");
  if (latest.reason === "not_configured") errors.unshift("OANDA is not configured");
  return {
    symbol,
    interval,
    latestInserted: latest.inserted,
    historicalInserted,
    repairedGaps: gapRepair.repaired,
    remainingGaps: gapRepair.remaining.slice(0, 20),
    coverage: await getAnalysisCoverage({ symbol, interval }),
    errors,
  };
}
