/**
 * Proactive notifications — event-driven, never scheduled (Phase 6).
 *
 * The sweep and the economic-event monitor OBSERVE; what they observe
 * becomes `market_event` resident events; this module decides who hears
 * about each one and delivers it. Three hard properties:
 *
 *  1. **Every notification traces to a specific market event** — the
 *     lifecycle event (type, recommendation, revision, dedupe key, detail,
 *     timestamp) rides inside the market_event payload and into the message.
 *  2. **Per-user preferences** — four categories (activation, target,
 *     invalidation, news_block); a category the user turned off is silence,
 *     recorded as such.
 *  3. **Exactly-once delivery** — a persisted `notify:`-prefixed claim in
 *     the same ledger the record path uses. Record and delivery are separate
 *     claims: the sweep recording an event is not the user hearing it.
 */
import { DEFAULT_LOCALE, t, type AppLocale } from "@/lib/i18n";
import { resolveUserLocale } from "@/lib/i18n/userLocale";
import { createLogger } from "@/lib/logger";
import type {
  LifecycleEvent,
  LifecycleEventType,
} from "@/lib/recommendations/lifecycleEvents";
import type { MarketEvent, ResidentEvent } from "./events";
import type { AgentRunContext } from "./host";
import { UnknownChannelError } from "./host";
import {
  DEFAULT_NOTIFICATION_PREFS,
  normalizeNotificationPrefs as normalizePrefs,
  type NotificationCategory,
  type NotificationPrefs,
} from "./notificationPrefs";

const log = createLogger("resident.notifications");

// The vocabulary (categories, types, defaults, normalizer) lives in the
// PURE module so the client settings card can import it without dragging
// this file's host/db graph into the browser bundle. Re-exported here so
// server callers keep one import site.
export {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_CATEGORIES,
  normalizeNotificationPrefs,
  type NotificationCategory,
  type NotificationPrefs,
} from "./notificationPrefs";

/**
 * Which lifecycle events are proactively pushed, and under which preference.
 * Everything else stays a ledger record: visible in the platform, never a
 * push. The four categories are the product's notification vocabulary —
 * activation triggered, target reached, invalidation hit, news block.
 */
const CATEGORY_BY_LIFECYCLE: Partial<Record<LifecycleEventType, NotificationCategory>> = {
  activated: "activation",
  tp1_hit: "target",
  tp2_hit: "target",
  tp3_hit: "target",
  sl_hit: "invalidation",
  invalidated: "invalidation",
  economic_event_near: "news_block",
};

export function categoryForLifecycleEvent(
  type: LifecycleEventType | string,
): NotificationCategory | null {
  return CATEGORY_BY_LIFECYCLE[type as LifecycleEventType] ?? null;
}

/** A market_event whose payload does not carry the lifecycle event it claims. */
export class MarketEventPayloadError extends Error {
  constructor(detail: string) {
    super(`market_event payload rejected: ${detail}`);
    this.name = "MarketEventPayloadError";
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function getNotificationPrefs(userId: number): Promise<NotificationPrefs> {
  const { queryOne } = await import("@/lib/db");
  const row = await queryOne<{ notification_prefs: string | null }>(
    "SELECT notification_prefs FROM trading_settings WHERE user_id = ?",
    [userId],
  );
  if (!row?.notification_prefs) return { ...DEFAULT_NOTIFICATION_PREFS };
  try {
    return normalizePrefs(JSON.parse(row.notification_prefs));
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

export async function setNotificationPrefs(
  userId: number,
  update: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const current = await getNotificationPrefs(userId);
  const next = normalizePrefs({ ...current, ...update });
  const { execute } = await import("@/lib/db");
  await execute(
    `INSERT INTO trading_settings (user_id, notification_prefs) VALUES (?,?)
     ON CONFLICT (user_id) DO UPDATE SET notification_prefs = excluded.notification_prefs`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

// ---------------------------------------------------------------------------
// Lifecycle events → market events
// ---------------------------------------------------------------------------

/** Wrap one observed lifecycle change as a resident market_event, or null
 *  when the change is ledger-only (not part of the push vocabulary). */
export function lifecycleToMarketEvent(
  userId: number,
  event: LifecycleEvent,
): MarketEvent | null {
  const category = categoryForLifecycleEvent(event.type);
  if (!category) return null;
  return {
    kind: "market_event",
    event: event.type,
    symbol: event.symbol,
    userId,
    recommendationId: String(event.recommendationId).slice(0, 64),
    payload: { category, lifecycle: { ...event } },
    enqueuedAt: Date.now(),
  };
}

/** Publish the notifiable subset of a sweep's events onto the resident bus. */
export async function publishLifecycleNotifications(
  userEvents: readonly { userId: number; event: LifecycleEvent }[],
  publish: (event: ResidentEvent) => Promise<string>,
): Promise<number> {
  let published = 0;
  for (const { userId, event } of userEvents) {
    const marketEvent = lifecycleToMarketEvent(userId, event);
    if (!marketEvent) continue;
    try {
      await publish(marketEvent);
      published += 1;
    } catch (error) {
      // A publish failure loses one notification, never the sweep.
      log.warn("market_event publish failed", {
        type: event.type,
        recommendationId: event.recommendationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return published;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface NotificationDeliveryResult {
  outcome:
    | "delivered"
    | "skipped_prefs"
    | "skipped_duplicate"
    | "skipped_no_user"
    | "skipped_uncategorized"
    | "no_channel";
  delivered: number;
}

function extractLifecycle(event: MarketEvent): LifecycleEvent {
  const raw = event.payload?.lifecycle;
  if (!raw || typeof raw !== "object") {
    throw new MarketEventPayloadError(
      `event ${event.event} carries no lifecycle payload — a notification must trace to the market event that caused it`,
    );
  }
  const lifecycle = raw as Partial<LifecycleEvent>;
  if (
    typeof lifecycle.type !== "string" ||
    typeof lifecycle.dedupeKey !== "string" ||
    typeof lifecycle.detail !== "string" ||
    typeof lifecycle.symbol !== "string"
  ) {
    throw new MarketEventPayloadError(
      `event ${event.event} lifecycle payload is missing type/dedupeKey/detail/symbol`,
    );
  }
  return lifecycle as LifecycleEvent;
}

/**
 * The recommendation id as a user may see it: a UUID keeps only its first
 * block (`#c438afb4` — enough to identify, nothing internal), anything else
 * is bounded. The full id stays in the ledger and the logs, where it belongs.
 */
export function shortRecommendationId(id: string): string {
  const uuid =
    /^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(id);
  if (uuid) return uuid[1]!;
  return id.length > 12 ? id.slice(0, 12) : id;
}

/** The user-facing message: category headline, the event's own detail, and
 *  the trace line naming exactly which market event this was. */
export function formatNotificationMessage(
  lifecycle: LifecycleEvent,
  category: NotificationCategory,
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  // The trace names the event in the reader's language — `tp1_hit` and
  // `economic_event_near` are internal vocabulary, not an answer — and an
  // event type outside the dictionary falls back to the category headline
  // rather than printing the raw enum.
  const eventKey = `notify.event.${lifecycle.type}`;
  const eventLabel = t(locale, eventKey);
  return [
    `🔔 ${t(locale, `notify.category.${category}`)}`,
    lifecycle.detail,
    t(locale, "notify.trace", {
      id: shortRecommendationId(String(lifecycle.recommendationId)),
      symbol: lifecycle.symbol,
      event:
        eventLabel === eventKey
          ? t(locale, `notify.category.${category}`)
          : eventLabel,
    }),
  ].join("\n");
}

/**
 * Deliver one market_event as a notification: preferences, then the
 * exactly-once claim, then every channel the user has bound. Claim-then-send
 * (the ledger's own doctrine): a crash between the two loses a message
 * rather than repeating one — duplicates train the operator to ignore the
 * channel.
 */
export async function deliverMarketEventNotification(
  event: MarketEvent,
  ctx: Pick<AgentRunContext, "sender">,
): Promise<NotificationDeliveryResult> {
  if (event.userId == null) {
    // Not per-user → nothing to push. (Platform-wide market events carry no
    // notification obligation yet.)
    return { outcome: "skipped_no_user", delivered: 0 };
  }
  const lifecycle = extractLifecycle(event);
  const category = categoryForLifecycleEvent(lifecycle.type);
  if (!category) {
    return { outcome: "skipped_uncategorized", delivered: 0 };
  }

  const prefs = await getNotificationPrefs(event.userId);
  if (!prefs[category]) {
    log.info("notification skipped by preference", {
      userId: event.userId,
      category,
      type: lifecycle.type,
    });
    return { outcome: "skipped_prefs", delivered: 0 };
  }

  const { claimNotificationDelivery } = await import(
    "@/lib/recommendations/lifecycleNotifier"
  );
  const fresh = await claimNotificationDelivery({
    userId: event.userId,
    dedupeKey: lifecycle.dedupeKey,
    eventType: lifecycle.type,
    symbol: lifecycle.symbol,
    occurredAt: lifecycle.occurredAt,
  });
  if (!fresh) {
    return { outcome: "skipped_duplicate", delivered: 0 };
  }

  const { listChannelBindings } = await import("./sessions");
  const bindings = await listChannelBindings(event.userId);
  // A proactive push is a bot reply like any other: it goes out in the
  // account's language, not in a language fixed at build time.
  const message = formatNotificationMessage(
    lifecycle,
    category,
    await resolveUserLocale(event.userId),
  );
  let delivered = 0;
  for (const binding of bindings) {
    try {
      const sender = ctx.sender(binding.channelType);
      await sender.sendText(
        { type: binding.channelType, id: binding.channelId },
        message,
      );
      delivered += 1;
    } catch (error) {
      if (error instanceof UnknownChannelError) continue; // no sender here (e.g. web)
      log.warn("notification channel send failed", {
        userId: event.userId,
        channel: binding.channelType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  log.info("notification processed", {
    userId: event.userId,
    category,
    type: lifecycle.type,
    recommendationId: lifecycle.recommendationId,
    delivered,
  });
  return { outcome: delivered > 0 ? "delivered" : "no_channel", delivered };
}
