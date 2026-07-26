/**
 * Server-side recommendation tracker sweep. Its lifecycle pass is deterministic:
 * pulls candles from the Candle Warehouse (OANDA-backed), evaluates each active
 * recommendation, and persists status/outcome changes. After that pass, a
 * separate orchestration layer may consume durable re-evaluation claims through
 * the unified brain. Runs independently of any browser session.
 */
import { getCandles } from "@/lib/candles/candleRepository";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import {
  getHigherInterval,
  normalizeCanonicalInterval,
} from "@/lib/markets/intervals";
import {
  biasFromCandles,
  calculateAtr,
  detectSwings,
  type AgentCandle,
} from "@/lib/agent/marketContext/detectors";
import {
  detectStructureEvents,
  latestStructureEvent,
} from "@/lib/agent/marketContext/structureEvents";
import { detectChartGeometry } from "@/lib/chart/geometry";
import { getEaLiveQuote } from "@/lib/eaLiveState";
import { spreadFromBidAsk } from "@/lib/spread";
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
  type ReevaluationTrigger,
} from "./reevaluationTriggers";
import {
  consumePendingReevaluationTriggers,
  type CycleDeps,
} from "./reevaluationCycle";
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
      validityCandles: rec.validityCandles,
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
  const atr = approximateAtr(candles);
  // Retest tracking inputs (plan §7 B.6). A breakout-retest plan's entry IS
  // the broken level, and the excursion is how far price ran beyond it since
  // creation — from the same candles the evaluator just walked. Without these
  // the retest_started / breakout_no_retest events can never fire.
  const isRetestPlan =
    typeof rec.setupType === "string" && rec.setupType.includes("retest");
  let retestLevel: number | null = null;
  let excursionAtr: number | null = null;
  if (isRetestPlan && Number.isFinite(rec.entry) && rec.entry > 0) {
    retestLevel = rec.entry;
    const since = candles.filter((c) => c.time > createdCandleTimeMs);
    if (atr && atr > 0 && since.length) {
      const excursion =
        rec.direction === "buy"
          ? Math.max(...since.map((c) => c.high)) - rec.entry
          : rec.entry - Math.min(...since.map((c) => c.low));
      excursionAtr = excursion > 0 ? excursion / atr : 0;
    }
  }
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
    atr,
    retestLevel,
    excursionAtr,
    revisionNo: rec.revisionNo ?? null,
  });
  if (result.outcome !== "pending") {
    return { recommendation: updated, events, reevaluations: [] };
  }

  // Re-evaluation triggers (constitution §6). The tracker NOTICES; it does not
  // decide and it does not touch a level. Admitted triggers request a fresh
  // decision cycle whose output is the only thing allowed to change the plan.
  const detectorCandles: AgentCandle[] = candles;
  const structureEvents = detectStructureEvents(
    detectorCandles,
    detectSwings(detectorCandles),
    calculateAtr(detectorCandles),
  );
  const latestStructure = latestStructureEvent(structureEvents);
  const brokeSinceLastSweep =
    latestStructure != null &&
    latestStructure.breakCandleTime > (rec.lastCheckedAt ?? rec.createdAt);

  const geometry = detectChartGeometry({ candles: detectorCandles, atr });
  const foundingPattern = rec.setupType?.toLowerCase().replaceAll("-", "_");
  const pattern = foundingPattern
    ? geometry.patterns.find(
        (candidate) =>
          candidate.patternType === foundingPattern ||
          foundingPattern.includes(candidate.patternType),
      )
    : null;
  const [higherCandles, quote] = await Promise.all([
    getCandles({
      symbol,
      interval: getHigherInterval(interval),
      limit: 200,
    }).catch(() => []),
    getEaLiveQuote(rec.userId, symbol).catch(() => null),
  ]);
  const higherBias = biasFromCandles(
    higherCandles.filter((candle) => candle.complete),
  );
  const modelContext =
    rec.evidenceSnapshot &&
    typeof rec.evidenceSnapshot.modelContext === "object"
      ? (rec.evidenceSnapshot.modelContext as Record<string, unknown>)
      : null;
  const cost =
    modelContext && typeof modelContext.executionCost === "object"
      ? (modelContext.executionCost as Record<string, unknown>)
      : null;
  const plannedSpread = Number(
    cost?.expected_spread ?? cost?.observed_spread ?? Number.NaN,
  );
  const currentSpread =
    quote && quote.quoteAgeMs <= 120_000
      ? spreadFromBidAsk(quote.bid, quote.ask, symbol)?.spreadPips
      : null;
  const contextChanged =
    brokeSinceLastSweep ||
    (rec.direction === "buy" && higherBias === "bearish") ||
    (rec.direction === "sell" && higherBias === "bullish") ||
    pattern?.stage === "failed" ||
    pattern?.status === "invalidated";

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
      foundingPattern: rec.setupType ?? null,
    },
    structure: latestStructure
      ? {
          brokeSinceLastSweep,
          bias: latestStructure.direction === "bullish" ? "up" : "down",
          eventKey: String(latestStructure.breakCandleTime),
        }
      : null,
    patternStage: pattern?.stage ?? pattern?.status ?? null,
    patternStageKey: pattern
      ? `${pattern.patternType}:${pattern.stage ?? pattern.status}:${pattern.anchors.at(-1)?.time ?? 0}`
      : null,
    higherTimeframeBias:
      higherBias === "bullish"
        ? "up"
        : higherBias === "bearish"
          ? "down"
          : "flat",
    spread:
      currentSpread != null &&
      Number.isFinite(plannedSpread) &&
      plannedSpread > 0
        ? { now: currentSpread, plannedFor: plannedSpread }
        : null,
    invalidationProximity:
      lastCandle &&
      atr &&
      (rec.invalidationLevel ?? rec.stopLoss) > 0
        ? {
            currentPrice: lastCandle.close,
            invalidationLevel: rec.invalidationLevel ?? rec.stopLoss,
            atr,
            contextChanged,
          }
        : null,
    now: Date.now(),
  });
  const { admitted, suppressed } = await admitTriggers(triggers);
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
    /**
     * Run re-evaluation cycles for admitted triggers. Off in replays and tests
     * that assert deterministic sweep output, since a cycle calls the brain.
     */
    reevaluate?: boolean;
    /** Provider seam for a full-pipeline integration test. */
    reevaluationDeps?: CycleDeps;
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
      const tracked = await trackOneRecommendation(rec);
      const { recommendation: next, events: recEvents } = tracked;
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
      // `admitTriggers` has already written durable claims. They are consumed
      // only after every symbol's deterministic lifecycle pass finishes.
      if (!next) continue;
      if (next.status !== rec.status || next.outcome !== rec.outcome) updated += 1;
      if (next.outcome !== "pending") terminal += 1;
    } catch {
      // A single failing symbol must not abort the whole sweep.
    }
  }

  // Re-evaluation cycles run AFTER the deterministic sweep, so a slow decision
  // never delays a stop-out. Each one re-runs the whole evidence pipeline through
  // the same brain and its output goes through applyRecommendationRevision — the
  // tracker still has not decided anything.
  if (opts.reevaluate !== false) {
    const cycles = await consumePendingReevaluationTriggers({
      userId: opts.userId,
      limit: opts.limit,
    }, {
      ...opts.reevaluationDeps,
      notifyInCycle: false,
      silentNotifications:
        opts.notify === false || opts.silentAlerts === true,
    }).catch(() => []);
    for (const cycle of cycles) {
      if (cycle.verdict === "skipped") continue;
      // Labels match what actually happened: a revision moved the plan
      // (entry_updated); an invalidation means the alternative scenario took
      // over (scenario_changed); a confirmation is announced as exactly what it
      // is — "looked again, stood by the plan" — because an operator who cannot
      // tell "re-checked and confirmed" from "nobody looked" can trust neither.
      if (cycle.verdict === "confirmed") {
        byUser.set(cycle.trigger.userId, [
          ...(byUser.get(cycle.trigger.userId) ?? []),
          {
            type: "reevaluation_confirmed",
            recommendationId: cycle.trigger.recommendationId,
            symbol: cycle.trigger.symbol,
            revisionNo: cycle.trigger.revisionNo,
            // The trigger's reason is part of the identity: the SAME condition
            // re-checked at the same revision stays silent, while a different
            // reason to look again is a different confirmation worth hearing.
            dedupeKey: `${cycle.trigger.recommendationId}:${cycle.trigger.revisionNo ?? 0}:reeval:confirmed:${cycle.trigger.reason}`,
            detail: cycle.detail,
            terminal: false,
            occurredAt: Date.now(),
          },
        ]);
        continue;
      }
      byUser.set(cycle.trigger.userId, [
        ...(byUser.get(cycle.trigger.userId) ?? []),
        {
          type: cycle.verdict === "invalidated" ? "scenario_changed" : "entry_updated",
          recommendationId: cycle.trigger.recommendationId,
          symbol: cycle.trigger.symbol,
          revisionNo: cycle.revision?.revisionNo ?? cycle.trigger.revisionNo,
          dedupeKey: `${cycle.trigger.recommendationId}:${cycle.revision?.revisionNo ?? 0}:reeval:${cycle.verdict}`,
          detail: cycle.detail,
          terminal: false,
          occurredAt: Date.now(),
        },
      ]);
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
 * (across every user), then drains durable re-evaluation claims after the
 * lifecycle pass. The caller (cron route) owns authentication and the
 * distributed overlap lock.
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
