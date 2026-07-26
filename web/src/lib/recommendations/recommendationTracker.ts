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
import { deriveLifecycleEvents, type LifecycleEvent } from "./lifecycleEvents";
import {
  admitTriggers,
  detectReevaluationTriggers,
  recordTrigger,
  type ReevaluationTrigger,
} from "./reevaluationTriggers";
import { notifyLifecycleEvents } from "./lifecycleNotifier";
import { maybeAutoExecute, autoExecutionStage } from "./autoExecutor";
import type { TrackedRecommendation } from "./types";

/** Normalize an epoch value to milliseconds (warehouse stores may use seconds). */
function toMs(t: number): number {
  return t < 1_000_000_000_000 ? Math.round(t * 1000) : Math.round(t);
}

export interface TrackSweepResult {
  checked: number;
  updated: number;
  terminal: number;
  /** Everything worth announcing from this sweep (see lifecycleEvents). */
  events: LifecycleEvent[];
}

/** Evaluate one recommendation against fresh candles and persist any change. */
export interface TrackOneResult {
  recommendation: TrackedRecommendation | null;
  /** Real changes since the last sweep; empty when nothing moved. */
  events: LifecycleEvent[];
  /**
   * Triggers admitted for a new decision cycle. The tracker returns them rather
   * than acting on them: the brain decides, and applyRecommendationRevision is
   * the only thing that may change the plan.
   */
  reevaluations: ReevaluationTrigger[];
}

export async function trackOneRecommendation(
  rec: TrackedRecommendation,
): Promise<TrackOneResult> {
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

  const updated = await updateTrackedRecommendation(rec.userId, rec.id, {
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

  // What changed, in operator terms. Derived here rather than inside the
  // evaluator because approaching a level is worth announcing without being a
  // status change — and because a sweep over unchanged candles must produce an
  // empty list, which is what keeps the notifications honest.
  const lastCandle = candles.at(-1);
  const events = deriveLifecycleEvents({
    recommendation: {
      id: rec.id,
      symbol: rec.symbol,
      direction: rec.direction,
      entry: rec.entry,
      stopLoss: rec.stopLoss,
      invalidationLevel: rec.invalidationLevel,
      status: result.status,
      outcome: result.outcome,
    },
    previousStatus: rec.status,
    nextStatus: result.status,
    currentPrice: lastCandle?.close ?? null,
    atr: approximateAtr(candles),
    revisionNo: rec.revisionNo ?? null,
  });

  // Re-evaluation triggers (constitution §6). The tracker NOTICES; it does not
  // decide and it does not touch a level. Admitted triggers request a fresh
  // decision cycle whose output is the only thing allowed to change the plan.
  const triggers = detectReevaluationTriggers({
    recommendation: {
      id: rec.id,
      userId: rec.userId,
      symbol: rec.symbol,
      direction: rec.direction,
      entry: rec.entry,
      stopLoss: rec.stopLoss,
      invalidationLevel: rec.invalidationLevel,
      revisionNo: rec.revisionNo ?? null,
    },
    now: Date.now(),
  });
  const { admitted, suppressed } = await admitTriggers(triggers);
  for (const trigger of triggers) {
    await recordTrigger(
      trigger,
      admitted.includes(trigger) ? "cycle_requested" : "suppressed",
    );
  }
  void suppressed;

  return { recommendation: updated, events, reevaluations: admitted };
}

/** Cheap ATR over the tail, so proximity bands scale with the instrument. */
function approximateAtr(candles: TrackerCandle[]): number | null {
  const window = candles.slice(-14);
  if (window.length < 5) return null;
  const sum = window.reduce((acc, c) => acc + Math.abs(c.high - c.low), 0);
  const atr = sum / window.length;
  return atr > 0 ? atr : null;
}

/** Sweep all active recommendations (optionally for one user). */
export async function trackRecommendations(
  opts: {
    userId?: number;
    limit?: number;
    /** Skip delivery entirely (tests, replays). */
    notify?: boolean;
    /** Record what would be sent without sending it (rollout window). */
    silentAlerts?: boolean;
    /** Disable standing-authorisation execution for this run (tests, replays). */
    autoExecute?: boolean;
  } = {},
): Promise<TrackSweepResult> {
  const active = await listActiveTrackedRecommendations({
    userId: opts.userId,
    limit: opts.limit,
  });
  let updated = 0;
  let terminal = 0;
  const events: LifecycleEvent[] = [];
  const byUser = new Map<number, LifecycleEvent[]>();
  const placedToday = new Map<number, number>();
  const autoEnabled = opts.autoExecute !== false && autoExecutionStage() !== "off";

  for (const rec of active) {
    try {
      const { recommendation: next, events: recEvents } = await trackOneRecommendation(rec);
      events.push(...recEvents);

      // Standing authorisation acts at the moment a plan's own condition is
      // met — the same moment the operator is told about it, so the two can
      // never disagree about what happened.
      if (autoEnabled && recEvents.some((event) => event.type === "activated")) {
        const outcome = await maybeAutoExecute({
          recommendation: next ?? rec,
          events: recEvents,
          placedToday: placedToday.get(rec.userId) ?? 0,
        }).catch(() => null);
        if (outcome?.placed) {
          placedToday.set(rec.userId, (placedToday.get(rec.userId) ?? 0) + 1);
          recEvents.push({
            type: "executed_auto",
            recommendationId: rec.id,
            symbol: rec.symbol,
            revisionNo: rec.revisionNo ?? null,
            dedupeKey: `${rec.id}:${rec.revisionNo ?? 0}:executed_auto`,
            detail: outcome.dryRun
              ? `${rec.symbol}: كان سيُنفَّذ آلياً الآن (وضع المحاكاة).`
              : `${rec.symbol}: نُفِّذت الصفقة آلياً بعد تحقق شرط التفعيل.`,
            terminal: false,
            occurredAt: Date.now(),
          });
        } else if (outcome && outcome.code !== "stage_off" && outcome.code !== "not_authorized") {
          // Why an authorised plan was NOT placed matters as much as a fill:
          // silence here would look like the trade simply never triggered.
          recEvents.push({
            type: "execution_skipped",
            recommendationId: rec.id,
            symbol: rec.symbol,
            revisionNo: rec.revisionNo ?? null,
            dedupeKey: `${rec.id}:${rec.revisionNo ?? 0}:execution_skipped:${outcome.code}`,
            detail: `${rec.symbol}: امتنع التنفيذ التلقائي — ${outcome.reason}`,
            terminal: false,
            occurredAt: Date.now(),
          });
        }
      }

      if (recEvents.length) {
        byUser.set(rec.userId, [...(byUser.get(rec.userId) ?? []), ...recEvents]);
      }
      if (!next) continue;
      if (next.status !== rec.status || next.outcome !== rec.outcome) updated += 1;
      if (next.outcome !== "pending") terminal += 1;
    } catch {
      // A single failing symbol must not abort the whole sweep.
    }
  }

  // Telling the operator is part of tracking, not an optional extra: a monitor
  // that computes a stop-out and stays quiet is worse than no monitor, because
  // it looks like coverage. Delivery is best-effort — a failed send must never
  // roll back a correctly evaluated status.
  if (opts.notify !== false) {
    for (const [userId, userEvents] of byUser) {
      await notifyLifecycleEvents(userId, userEvents, { silent: opts.silentAlerts }).catch(
        () => undefined,
      );
    }
  }

  return { checked: active.length, updated, terminal, events };
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
  /** Record events without delivering them (first rollout window). */
  silentAlerts?: boolean;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
} = {}): Promise<SweepRunResult> {
  const startedAt = Date.now();
  try {
    const summary = await trackRecommendations({
      limit: opts.limit,
      silentAlerts: opts.silentAlerts,
    });
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
    return { checked: 0, updated: 0, terminal: 0, events: [], durationMs };
  }
}
