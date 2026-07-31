/**
 * Economic-event proximity for ACTIVE recommendations (plan §8 C.6).
 *
 * The monitor's job here is factual and small: a high-impact calendar release
 * is minutes away, it touches a currency of a plan the operator is holding,
 * and the operator should hear about it BEFORE the candle prints — once.
 *
 * Two outputs, both through existing machinery, neither a decision:
 *
 *  1. A notification per (recommendation, event, revision), delivered through
 *     the lifecycle notifier so its persisted dedupe key makes "once" a
 *     database guarantee rather than an intention.
 *  2. A re-evaluation trigger with the existing `economic_event` reason,
 *     admitted through the same rate limits every automatic trigger obeys, so
 *     the unified brain — and only the brain — can re-decide the plan.
 *
 * With no news provider configured there is NOTHING here: no invented events,
 * no placeholder risk. Honest absence is the contract the news layer already
 * keeps, and this module inherits it.
 */
import { query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  getNewsProvider,
  newsProviderConfigured,
  type EconomicEvent,
  type NewsProvider,
} from "@/lib/agent/news/newsProvider";
import { affectedCurrencies } from "@/lib/markets/symbolMapping";
import type { LifecycleEvent } from "./lifecycleEvents";
import {
  notifyLifecycleEvents,
  type NotifyResult,
} from "./lifecycleNotifier";
import {
  admitTriggers,
  type ReevaluationTrigger,
} from "./reevaluationTriggers";
import {
  runReevaluationCycles,
  type CycleResult,
} from "./reevaluationCycle";

const log = createLogger("recommendations:economic-events");

/**
 * How close a high-impact release must be before it is worth an alert.
 *
 * Sixty minutes: wide enough that a conditional entry sitting near its trigger
 * can still be reconsidered, narrow enough that the alert describes something
 * imminent rather than "sometime today".
 */
export const EVENT_PROXIMITY_MINUTES = 60;

/** Statuses that mean the operator is actually holding or awaiting this plan. */
const LIVE_STATUSES = ["active", "triggered", "partially_closed"] as const;

interface ActiveRecRow {
  id: number;
  legacy_tracking_id: string | null;
  symbol: string;
  direction: string;
  effective_revision_no: number | null;
}

/** Injectable seams so tests run without FMP keys or a live brain. */
export interface EconomicProximityDeps {
  provider?: NewsProvider | null;
  providerConfigured?: boolean;
  notify?: typeof notifyLifecycleEvents;
  runCycles?: typeof runReevaluationCycles;
  now?: number;
}

export interface EconomicProximityResult {
  /** Proximity events derived this sweep (before dedupe). */
  events: LifecycleEvent[];
  /** What the notifier did with them — dedupe counts included. */
  notify: NotifyResult;
  /** Triggers the rate limiter let through to request a decision cycle. */
  admittedTriggers: ReevaluationTrigger[];
  /** Cycle verdicts, when any trigger was admitted. */
  cycles: CycleResult[];
}

const EMPTY_NOTIFY: NotifyResult = {
  delivered: 0,
  suppressedDuplicate: 0,
  suppressedRateLimit: 0,
  suppressedSilent: 0,
};

function emptyResult(): EconomicProximityResult {
  return { events: [], notify: { ...EMPTY_NOTIFY }, admittedTriggers: [], cycles: [] };
}

function minutesAway(event: EconomicEvent, now: number): number {
  return (new Date(event.time).getTime() - now) / 60_000;
}

/**
 * Sweep one user's active recommendations against the calendar.
 *
 * Called from the general monitoring cycle. Everything is best-effort: a
 * provider outage or a notifier failure degrades to silence, never to an
 * invented event or a duplicate alert.
 */
export async function checkEconomicEventProximity(
  userId: number,
  deps: EconomicProximityDeps = {},
): Promise<EconomicProximityResult> {
  const configured = deps.providerConfigured ?? newsProviderConfigured();
  if (!configured) return emptyResult();
  const provider = deps.provider !== undefined ? deps.provider : getNewsProvider();
  // Provider absent or broken → honest nothing. Never fabricate a calendar.
  if (!provider) return emptyResult();

  const now = deps.now ?? Date.now();
  const recs = await query<ActiveRecRow>(
    `SELECT id, legacy_tracking_id, symbol, direction, effective_revision_no
       FROM recommendations
      WHERE user_id = ? AND direction IN ('buy','sell')
        AND status IN (${LIVE_STATUSES.map(() => "?").join(",")})
      ORDER BY id DESC LIMIT 100`,
    [userId, ...LIVE_STATUSES],
  ).catch(() => []);
  if (!recs.length) return emptyResult();

  const result = emptyResult();
  const from = new Date(now);
  const to = new Date(now + EVENT_PROXIMITY_MINUTES * 60_000);
  // One calendar read per symbol: the provider owns the currency matching
  // (including the gold/USD nuance), and caches the upstream fetch itself.
  const eventsBySymbol = new Map<string, EconomicEvent[]>();

  for (const rec of recs) {
    let events = eventsBySymbol.get(rec.symbol);
    if (!events) {
      events = await provider
        .getEconomicEvents({ currencies: affectedCurrencies(rec.symbol), from, to })
        .catch((error: unknown) => {
          // An upstream failure is an unknown calendar, not an empty one — but
          // for alert purposes both correctly produce no alert.
          log.warn("calendar fetch failed", {
            symbol: rec.symbol,
            error: error instanceof Error ? error.message : String(error),
          });
          return [] as EconomicEvent[];
        });
      eventsBySymbol.set(rec.symbol, events);
    }

    const recRef = rec.legacy_tracking_id ?? String(rec.id);
    const revisionNo = rec.effective_revision_no ?? null;
    const imminent = events.filter((event) => {
      const minutes = minutesAway(event, now);
      return event.impact === "high" && minutes >= 0 && minutes <= EVENT_PROXIMITY_MINUTES;
    });

    for (const event of imminent) {
      const minutes = Math.max(0, Math.round(minutesAway(event, now)));
      result.events.push({
        type: "economic_event_near",
        recommendationId: recRef,
        symbol: rec.symbol,
        revisionNo,
        // (rec, event, revision) — the same identity the lifecycle notifier
        // enforces: the same release for the same plan is announced once, and a
        // plan re-issued at new levels legitimately re-announces.
        dedupeKey: `${recRef}:${revisionNo ?? 0}:economic_event_near:${event.currency ?? ""}:${event.title}@${event.time}`,
        detail: `${rec.symbol}: حدث اقتصادي عالي التأثير «${event.title}» بعد ${minutes} دقيقة${event.currency ? ` (${event.currency})` : ""} — قد يطال التوصية النشطة.`,
        terminal: false,
        occurredAt: now,
      });
    }

    if (!imminent.length) continue;

    // One trigger per plan per sweep is one request for one decision cycle —
    // the same restraint the tracker's detector applies. The trigger carries
    // NO direction and NO levels; the brain re-decides or the plan stands.
    const first = imminent[0]!;
    const trigger: ReevaluationTrigger = {
      recommendationId: recRef,
      userId,
      symbol: rec.symbol,
      reason: "economic_event",
      detail: `${rec.symbol}: ${first.title} بعد ${Math.max(0, Math.round(minutesAway(first, now)))} دقيقة (${first.impact}).`,
      source: "monitor",
      revisionNo,
      raisedAt: now,
      idempotencyKey: `event:${first.currency ?? ""}:${first.title}@${first.time}`,
    };
    const { admitted } = await admitTriggers([trigger]);
    for (const admittedTrigger of admitted) {
      result.admittedTriggers.push(admittedTrigger);
    }
    if (admitted.length) {
      const runCycles = deps.runCycles ?? runReevaluationCycles;
      const cycles = await runCycles(
        admitted.map((item) => ({ trigger: item, canonicalId: rec.id })),
      ).catch(() => [] as CycleResult[]);
      result.cycles.push(...cycles);
    }
  }

  if (result.events.length) {
    const notify = deps.notify ?? notifyLifecycleEvents;
    result.notify = await notify(userId, result.events).catch(() => ({
      ...EMPTY_NOTIFY,
    }));
  }

  return result;
}
