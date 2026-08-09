/**
 * Warehouse-first candle service for /api/market/klines.
 *
 * Reads AiChart's own `market_candles` store first and only reaches the linked
 * broker account (via MetaApi) when coverage is missing or stale — the broker
 * is the upstream provider, not the per-request source. Derived intervals (3m, 45m…) are read/backfilled at their
 * native base and resampled here, so the warehouse only ever stores native
 * broker candles (no duplicate higher-timeframe rows).
 */
import { resampleOhlc } from "@/lib/intervals";
import {
  candleFreshnessToleranceMs,
  canonicalPlan,
} from "@/lib/markets/intervals";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import {
  getCandles,
  getCoverage,
  type StoredCandle,
  type WarehouseCoverage,
} from "./candleRepository";
import { FEATURES } from "@/lib/agent/featureFlags";
import { backfillCandles, triggerBackfill } from "./candleBackfillService";
import { recordWarmDemand } from "./warmDemand";

export interface WarehouseOhlcResult {
  candles: StoredCandle[];
  source:
    | "warehouse"
    | "warehouse_partial"
    | "broker_backfill"
    | "broker_refresh";
  coverage: WarehouseCoverage;
  backfillStatus: "not_needed" | "triggered" | "completed" | "already_running";
  hasMore: boolean;
}

export interface WarehouseOhlcParams {
  symbol: string;
  interval: string;
  limit: number;
  fresh?: boolean;
  fromMs?: number;
  toMs?: number;
  /** Backward pagination cursor (open time, ms, exclusive upper bound). */
  beforeMs?: number;
}

/** "Enough" coverage to skip the broker on a latest-N request. */
function enoughForLatest(count: number, limit: number): boolean {
  return count >= Math.min(Math.floor(limit * 0.7), 300);
}

function resample(base: StoredCandle[], factor: number): StoredCandle[] {
  if (factor <= 1) return base;
  return resampleOhlc(base, factor).map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
    complete: true,
  }));
}

/** Is the newest stored candle recent enough that we needn't refresh now? */
function isFresh(coverage: WarehouseCoverage, interval: string): boolean {
  if (coverage.lastTime == null) return false;
  return Date.now() - coverage.lastTime <= candleFreshnessToleranceMs(interval);
}

export async function serveWarehouseOhlc(
  params: WarehouseOhlcParams,
): Promise<WarehouseOhlcResult> {
  const symbol = forexCanonicalKey(params.symbol);
  // Derived interval (e.g. 3m) → native base + resample factor.
  const plan = canonicalPlan(params.interval);
  const base = plan.base;
  const factor = Math.max(1, plan.factor);
  const baseLimit = Math.min(params.limit * factor, 10_000);

  const readWindow = () =>
    getCandles({
      symbol,
      interval: base,
      fromMs: params.fromMs,
      toMs: params.beforeMs ?? params.toMs,
      limit: baseLimit,
    });

  const coverage = () => getCoverage({ symbol, interval: base });

  // Fresh refresh: skip the read, pull the latest window from the linked broker account, then read.
  if (params.fresh) {
    const bf = await backfillCandles({
      symbol,
      interval: base,
      fromMs: params.fromMs,
      toMs: params.toMs,
      limit: baseLimit,
    });
    const rows = await readWindow();
    return {
      candles: resample(rows, factor),
      source: "broker_refresh",
      coverage: await coverage(),
      backfillStatus: bf.skipped ? "already_running" : "completed",
      hasMore: true,
    };
  }

  const rows = await readWindow();
  const cov = await coverage();
  const resampled = resample(rows, factor);
  const isRange = params.fromMs != null || params.beforeMs != null;

  // Range (chart scroll / getBars window): serve what we have if it looks
  // complete AND fresh; otherwise backfill the window and re-read.
  if (isRange) {
    const fresh = isFresh(cov, base);
    if (resampled.length > 0 && (fresh || resampled.length >= params.limit * 0.5)) {
      // Top up the tail in the background if the newest candle is stale.
      if (!fresh) triggerBackfill({ symbol, interval: base, limit: baseLimit });
      return {
        candles: resampled,
        source: fresh ? "warehouse" : "warehouse_partial",
        coverage: cov,
        backfillStatus: fresh ? "not_needed" : "triggered",
        hasMore: true,
      };
    }
    void recordWarmDemand({ symbol, interval: base });
    const bf = await backfillCandles({
      symbol,
      interval: base,
      fromMs: params.fromMs,
      toMs: params.beforeMs ?? params.toMs,
      limit: baseLimit,
      ...(FEATURES.boundedColdStartV1() ? { maxPages: 1 } : {}),
    });
    const after = await readWindow();
    return {
      candles: resample(after, factor),
      source: "broker_backfill",
      coverage: await coverage(),
      backfillStatus: bf.skipped ? "already_running" : "completed",
      hasMore: true,
    };
  }

  // Latest-N request. Serve warehouse when coverage is sufficient AND fresh.
  const fresh = isFresh(cov, base);
  if (enoughForLatest(resampled.length, params.limit) && fresh) {
    return {
      candles: resampled,
      source: "warehouse",
      coverage: cov,
      backfillStatus: "not_needed",
      hasMore: true,
    };
  }

  // Sufficient count but stale tail: serve immediately, refresh in background.
  if (enoughForLatest(resampled.length, params.limit) && !fresh) {
    triggerBackfill({ symbol, interval: base, limit: baseLimit });
    return {
      candles: resampled,
      source: "warehouse_partial",
      coverage: cov,
      backfillStatus: "triggered",
      hasMore: true,
    };
  }

  // Thin coverage — the cold-start path, and the one that was failing.
  //
  // This used to page as deep as the range fetcher allowed (10 pages, 12s
  // each) while the operator waited behind a 10s market-data deadline: the
  // request could not win, and the abandoned pages kept running for another
  // two minutes, slowing whatever came next. One page answers the request;
  // the depth belongs to the cron, so the series is registered for warming
  // and the next analysis on this pair reads locally.
  void recordWarmDemand({ symbol, interval: base });
  const bf = await backfillCandles({
    symbol,
    interval: base,
    limit: baseLimit,
    ...(FEATURES.boundedColdStartV1() ? { maxPages: 1 } : {}),
  });
  const after = await readWindow();
  const afterResampled = resample(after, factor);
  if (afterResampled.length > 0) {
    return {
      candles: afterResampled,
      source: "broker_backfill",
      coverage: await coverage(),
      backfillStatus: bf.skipped ? "already_running" : "completed",
      hasMore: true,
    };
  }

  // Nothing after backfill (unsupported symbol/interval or market gap).
  return {
    candles: [],
    source: "broker_backfill",
    coverage: await coverage(),
    backfillStatus: bf.skipped ? "already_running" : "completed",
    hasMore: false,
  };
}
