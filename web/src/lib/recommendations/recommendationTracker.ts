/**
 * Server-side recommendation tracker sweep. Deterministic and LLM-free: it
 * pulls candles from the Candle Warehouse (OANDA-backed), evaluates each active
 * recommendation, and persists status/outcome changes. Runs independently of any
 * browser session (called from an API route or a scheduled job). Never executes
 * trades.
 */
import { getCandles } from "@/lib/candles/candleRepository";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import {
  listActiveTrackedRecommendations,
  updateTrackedRecommendation,
} from "./recommendationStore";
import {
  evaluateRecommendation,
  type TrackerCandle,
} from "./recommendationStatus";
import type { TrackedRecommendation } from "./types";

/** Normalize an epoch value to milliseconds (warehouse stores may use seconds). */
function toMs(t: number): number {
  return t < 1_000_000_000_000 ? Math.round(t * 1000) : Math.round(t);
}

export interface TrackSweepResult {
  checked: number;
  updated: number;
  terminal: number;
}

/** Evaluate one recommendation against fresh candles and persist any change. */
export async function trackOneRecommendation(
  rec: TrackedRecommendation,
): Promise<TrackedRecommendation | null> {
  const symbol = forexCanonicalKey(rec.symbol);
  const interval = normalizeCanonicalInterval(rec.interval);
  const createdCandleTimeMs = toMs(rec.createdCandleTime);

  const stored = await getCandles({
    symbol,
    interval,
    fromMs: createdCandleTimeMs,
    limit: 2000,
  });
  const candles: TrackerCandle[] = stored
    .filter((c) => c.complete)
    .map((c) => ({
      time: toMs(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

  const result = evaluateRecommendation({
    recommendation: {
      direction: rec.direction,
      entryType: rec.entryType,
      entry: rec.entry,
      stopLoss: rec.stopLoss,
      targets: rec.targets,
      invalidationLevel: rec.invalidationLevel,
      status: rec.status,
      outcome: rec.outcome,
      createdAt: toMs(rec.createdAt),
      createdCandleTime: createdCandleTimeMs,
      expiresAt: rec.expiresAt,
      triggeredAt: rec.triggeredAt,
      tp1HitAt: rec.tp1HitAt,
      tp2HitAt: rec.tp2HitAt,
      tp3HitAt: rec.tp3HitAt,
    },
    candles,
  });

  return updateTrackedRecommendation(rec.userId, rec.id, {
    status: result.status,
    outcome: result.outcome,
    triggeredAt: result.triggeredAt,
    tp1HitAt: result.tp1HitAt,
    tp2HitAt: result.tp2HitAt,
    tp3HitAt: result.tp3HitAt,
    slHitAt: result.slHitAt,
    expiredAt: result.expiredAt,
    lastCheckedAt: Date.now(),
  });
}

/** Sweep all active recommendations (optionally for one user). */
export async function trackRecommendations(
  opts: { userId?: number; limit?: number } = {},
): Promise<TrackSweepResult> {
  const active = await listActiveTrackedRecommendations({
    userId: opts.userId,
    limit: opts.limit,
  });
  let updated = 0;
  let terminal = 0;
  for (const rec of active) {
    try {
      const next = await trackOneRecommendation(rec);
      if (!next) continue;
      if (next.status !== rec.status || next.outcome !== rec.outcome) updated += 1;
      if (next.outcome !== "pending") terminal += 1;
    } catch {
      // A single failing symbol must not abort the whole sweep.
    }
  }
  return { checked: active.length, updated, terminal };
}

export interface SweepRunResult extends TrackSweepResult {
  durationMs: number;
}

/**
 * Scheduled-sweep entry point: evaluates ALL non-terminal recommendations
 * (across every user), timing the run and logging aggregate counts + failure
 * classes. Idempotent (re-evaluating the same candles yields the same outcome),
 * LLM-free, and never executes trades. Safe no-op when nothing is active. The
 * caller (cron route) owns authentication and the distributed overlap lock.
 */
export async function runRecommendationSweep(opts: {
  limit?: number;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
} = {}): Promise<SweepRunResult> {
  const startedAt = Date.now();
  try {
    const summary = await trackRecommendations({ limit: opts.limit });
    const durationMs = Date.now() - startedAt;
    opts.logger?.info("recommendation.sweep.done", {
      checked: summary.checked,
      updated: summary.updated,
      terminal: summary.terminal,
      durationMs,
    });
    return { ...summary, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    // A whole-sweep failure (e.g. warehouse/DB outage) is logged by class only.
    opts.logger?.warn("recommendation.sweep.failed", {
      error: err instanceof Error ? err.name : "unknown",
      durationMs,
    });
    return { checked: 0, updated: 0, terminal: 0, durationMs };
  }
}
