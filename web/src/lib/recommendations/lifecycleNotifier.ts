/**
 * Delivery for recommendation lifecycle events
 * (docs/UNIFIED_AGENT_PLAN.md §14).
 *
 * The sweep has always computed activation, targets, stops, and expiry — and
 * then said nothing. Connecting it is only half the job: a monitor that runs
 * every few minutes will happily repeat itself forever, and an operator who
 * gets five messages about the same candle stops reading all of them.
 *
 * So delivery is governed by three rules:
 *  1. one message per real change, enforced by a persisted dedupe key;
 *  2. simultaneous changes to one plan arrive as a single grouped message;
 *  3. chatter is rate-capped per symbol, and terminal events are exempt —
 *     "your stop was hit" must never be dropped for being the sixth message.
 */
import { execute, queryOne } from "@/lib/db";
import { dispatchAlert } from "@/lib/alerts";
import { createLogger } from "@/lib/logger";
import type { LifecycleEvent } from "./lifecycleEvents";
import { FEATURES } from "@/lib/agent/featureFlags";
import { metrics } from "@/lib/metrics";

const log = createLogger("lifecycle-notify");

/** Non-terminal alerts per symbol per window. Terminal events ignore this. */
const RATE_LIMIT_PER_SYMBOL = 4;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Record-then-send, so a crash between the two loses a message rather than
 * repeating one. For a monitor the operator lives with, duplicates are the
 * worse failure: they train them to ignore the channel.
 */
async function claimDedupeKey(input: {
  userId: number;
  event: LifecycleEvent;
}): Promise<boolean> {
  try {
    const result = await execute(
      `INSERT INTO alert_dedupe (user_id, dedupe_key, event_type, symbol, created_at)
       VALUES (?,?,?,?,?)`,
      [
        input.userId,
        input.event.dedupeKey,
        input.event.type,
        input.event.symbol,
        input.event.occurredAt,
      ],
    );
    return result.changes > 0;
  } catch {
    // Unique violation — this exact change was already announced.
    return false;
  }
}

async function symbolAlertCount(input: {
  userId: number;
  symbol: string;
  since: number;
}): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM alert_dedupe
      WHERE user_id = ? AND symbol = ? AND created_at >= ?`,
    [input.userId, input.symbol, input.since],
  ).catch(() => null);
  return Number(row?.count ?? 0);
}

export interface NotifyOptions {
  /**
   * Record the events and suppress sending. Used for the first rollout window
   * so the real message volume can be measured before anyone's phone is
   * involved.
   */
  silent?: boolean;
}

export interface NotifyResult {
  delivered: number;
  suppressedDuplicate: number;
  suppressedRateLimit: number;
  suppressedSilent: number;
}

/**
 * Deliver a sweep's events for one user.
 *
 * Events for the same recommendation are grouped into one message; the dedupe
 * key of each member is still claimed individually, so a later sweep that
 * repeats only part of the group stays silent.
 */
export async function notifyLifecycleEvents(
  userId: number,
  events: LifecycleEvent[],
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  const result: NotifyResult = {
    delivered: 0,
    suppressedDuplicate: 0,
    suppressedRateLimit: 0,
    suppressedSilent: 0,
  };
  if (!events.length) return result;
  // Gated by REC_LIFECYCLE_ALERTS_V1. Off returns the pre-phase silence: events
  // are still derived and recorded upstream, only DELIVERY stops. Counted as
  // silent-suppressed so the sweep's own accounting still adds up. Distinct from
  // RECOMMENDATION_ALERTS_SILENT, which is a temporary launch mode rather than a
  // phase rollback.
  if (!FEATURES.recLifecycleAlertsV1()) {
    result.suppressedSilent = events.length;
    return result;
  }

  const byRecommendation = new Map<string, LifecycleEvent[]>();
  for (const event of events) {
    byRecommendation.set(event.recommendationId, [
      ...(byRecommendation.get(event.recommendationId) ?? []),
      event,
    ]);
  }

  const windowStart = Date.now() - RATE_WINDOW_MS;

  for (const group of byRecommendation.values()) {
    const fresh: LifecycleEvent[] = [];
    for (const event of group) {
      if (await claimDedupeKey({ userId, event })) fresh.push(event);
      else {
        result.suppressedDuplicate += 1;
        metrics.duplicateNotifications.inc();
      }
    }
    if (!fresh.length) continue;

    if (options.silent) {
      result.suppressedSilent += fresh.length;
      continue;
    }

    const hasTerminal = fresh.some((event) => event.terminal);
    if (!hasTerminal) {
      const recent = await symbolAlertCount({
        userId,
        symbol: fresh[0]!.symbol,
        since: windowStart,
      });
      if (recent > RATE_LIMIT_PER_SYMBOL) {
        result.suppressedRateLimit += fresh.length;
        log.info("lifecycle.alert.rate_limited", {
          userId,
          symbol: fresh[0]!.symbol,
          recent,
        });
        continue;
      }
    }

    const title = groupTitle(fresh);
    const text = fresh.map((event) => `• ${event.detail}`).join("\n");
    const delivery = await dispatchAlert(userId, {
      type: "signal",
      title,
      text,
      symbol: fresh[0]!.symbol,
    }).catch((error: unknown) => {
      log.warn("lifecycle.alert.failed", {
        userId,
        symbol: fresh[0]!.symbol,
        error: error instanceof Error ? error.name : "unknown",
      });
      return null;
    });
    if (delivery) result.delivered += 1;
  }

  return result;
}

function groupTitle(events: LifecycleEvent[]): string {
  const symbol = events[0]!.symbol;
  if (events.length === 1) return `${symbol} · ${eventLabel(events[0]!.type)}`;
  return `${symbol} · ${events.length} تحديثات على التوصية`;
}

function eventLabel(type: LifecycleEvent["type"]): string {
  switch (type) {
    case "opportunity_created":
      return "فرصة جديدة";
    case "approaching_entry":
      return "اقتراب من الدخول";
    case "activated":
      return "تفعّلت";
    case "approaching_invalidation":
      return "اقتراب من الإبطال";
    case "entry_updated":
      return "تحديث الخطة";
    case "scenario_changed":
      return "تغيّر السيناريو";
    case "tp1_hit":
      return "الهدف الأول";
    case "tp2_hit":
      return "الهدف الثاني";
    case "tp3_hit":
      return "الهدف الثالث";
    case "sl_hit":
      return "وقف الخسارة";
    case "invalidated":
      return "أُبطلت";
    case "expired":
      return "انتهت الصلاحية";
    case "executed_auto":
      return "نُفّذت آلياً";
    case "execution_skipped":
      return "امتنع التنفيذ";
    case "economic_event_near":
      return "حدث اقتصادي وشيك";
    default:
      return "تحديث";
  }
}
