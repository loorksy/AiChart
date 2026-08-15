/**
 * Server-side recommendation tracker sweep.
 *
 * Its lifecycle pass is deterministic: pulls closed candles from OANDA at
 * platform level — there is no linked broker account and never was one on this
 * path — evaluates each active recommendation, and persists status/outcome
 * changes. After that pass, a separate orchestration layer may consume durable
 * re-evaluation claims through the unified brain.
 *
 * Runs independently of any browser session, and places nothing: the sweep
 * grades plans, it does not act on them.
 */
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { getForexLiveQuote } from "@/lib/markets/forexPrice";
import { pipSizeForSymbol } from "@/lib/spread";
import { isCandleComplete } from "@/lib/ohlc/candleTime";
import { barDurationMs } from "@/lib/intervals";
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
import { costEvidencePips } from "@/lib/agent/marketContext/costEvidence";
import {
  listActiveTrackedRecommendations,
  updateTrackedRecommendation,
} from "./recommendationStore";
import {
  evaluateRecommendation,
  type TrackerCandle,
} from "./recommendationStatus";
import { activationRuleTimeframe } from "./activationRule";
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

/**
 * The current spread in pips, or null when no quote is available.
 *
 * Best-effort by contract: a sweep runs over every active plan and must not
 * fail one because the book went quiet for a second. Absent means the drift
 * check does not run for this plan on this pass, never that the spread is fine.
 */
async function liveSpreadPips(symbol: string): Promise<number | null> {
  const quote = await getForexLiveQuote(0, symbol, { timeoutMs: 2_000 }).catch(
    () => null,
  );
  if (!quote) return null;
  const spread = quote.ask - quote.bid;
  if (!Number.isFinite(spread) || spread < 0) return null;
  const pip = pipSizeForSymbol(symbol, (quote.ask + quote.bid) / 2);
  if (!(pip > 0)) return null;
  return spread / pip;
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

  const stored = await fetchOhlc({
    userId: rec.userId,
    symbol,
    interval,
    fromMs: createdCandleTimeMs,
    skipCache: true,
  });
  const candles: TrackerCandle[] = stored.candles
    .filter((c) => isCandleComplete(c.time, interval))
    .map((c) => ({
      time: toMs(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

  // A rule that names its OWN timeframe (e.g. a 15m close-below on a 5m plan)
  // is graded on that timeframe's candles, never the plan's.
  const ruleTimeframeRaw = rec.activationRule
    ? activationRuleTimeframe(rec.activationRule)
    : null;
  const ruleInterval = ruleTimeframeRaw
    ? normalizeCanonicalInterval(ruleTimeframeRaw)
    : null;
  let activationCandles: TrackerCandle[] | undefined;
  let activationBarMs: number | undefined;
  if (rec.activationRule && ruleInterval && ruleInterval !== interval) {
    const ruleStored = await fetchOhlc({
      userId: rec.userId,
      symbol,
      interval: ruleInterval,
      fromMs: createdCandleTimeMs,
      skipCache: true,
    })
      .then((r) => r.candles)
      .catch(() => []);
    const complete = ruleStored.filter((c) => isCandleComplete(c.time, ruleInterval));
    if (complete.length) {
      activationCandles = complete.map((c) => ({
        time: toMs(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      activationBarMs = barDurationMs(ruleInterval);
    }
  }

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
      // The seam that once dropped the whole conditional contract: the rule is
      // loaded from the store above and MUST reach the evaluator, or every
      // plan degrades to a bare entry touch.
      activationRule: rec.activationRule,
    },
    candles,
    activationCandles,
    activationBarMs,
  });

  // The execution state is a function of the market from here on. The card
  // badge reads this — leaving it at its creation value is how a plan whose
  // condition was satisfied kept saying "بانتظار التفعيل" forever.
  const nextExecutionState =
    result.status === "expired"
      ? ("expired" as const)
      : result.status === "invalidated"
        ? ("invalidated" as const)
        : result.triggered
          ? ("valid_now" as const)
          : undefined;

  const updated = await updateTrackedRecommendation(rec.userId, rec.id, {
    status: result.status,
    outcome: result.outcome,
    triggeredAt: result.triggeredAt,
    tp1HitAt: result.tp1HitAt,
    tp2HitAt: result.tp2HitAt,
    tp3HitAt: result.tp3HitAt,
    slHitAt: result.slHitAt,
    expiredAt: result.expiredAt,
    executionState: nextExecutionState,
    activationEvidence: result.activationEvidence,
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
    missedWithoutFill: result.missedWithoutFill ?? null,
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
  // The event fires when the break candle CLOSED after the last sweep. Its
  // OPEN time is almost always older than the previous sweep on any timeframe
  // at or above the sweep cadence — comparing opens meant structure_break
  // could never fire on 1h+ plans.
  const barMs = barDurationMs(interval);
  const brokeSinceLastSweep =
    latestStructure != null &&
    toMs(latestStructure.breakCandleTime) + barMs >
      (rec.lastCheckedAt ?? rec.createdAt);

  const geometry = detectChartGeometry({ candles: detectorCandles, atr });
  const foundingPattern = rec.setupType?.toLowerCase().replaceAll("-", "_");
  const pattern = foundingPattern
    ? geometry.patterns.find(
        (candidate) =>
          candidate.patternType === foundingPattern ||
          foundingPattern.includes(candidate.patternType),
      )
    : null;
  const higherInterval = getHigherInterval(interval);
  const higherCandles = await fetchOhlc({
    userId: rec.userId,
    symbol,
    interval: higherInterval,
    limit: 200,
    skipCache: true,
  })
    .then((r) => r.candles)
    .catch(() => []);
  const higherBias = biasFromCandles(
    higherCandles.filter((candle) => isCandleComplete(candle.time, higherInterval)),
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
  // Canonical PIPS keys, with the pre-contract price-unit names read as a
  // fallback so old rows still compare. `currentSpread` below is in pips, so
  // reading a price-unit number here was a ~10^4 error waiting to happen — and
  // with the V2 pipeline on, neither old key existed, so this was NaN and the
  // spread-drift trigger never fired at all.
  const plannedSpread = costEvidencePips(cost);
  // The live half of the comparison.
  //
  // This was hardcoded `null` — "no live-quote source since the EA bridge was
  // removed" — which disabled spread drift entirely: a plan costed at 20 pips
  // and now trading at 60 re-evaluated for every reason EXCEPT the one that
  // had actually invalidated it. There IS a source now, the same platform-level
  // OANDA book G7 revalidates against.
  //
  // Converted to PIPS, because `plannedSpread` is pips and comparing a price
  // difference against it is a ~10^4 error — the same units bug this block's
  // own comment above records having already been caught once.
  const currentSpread = await liveSpreadPips(rec.symbol);
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

  for (const rec of active) {
    try {
      const tracked = await trackOneRecommendation(rec);
      const { recommendation: next, events: recEvents } = tracked;
      events.push(...recEvents);

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
