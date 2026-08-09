/**
 * Notification fan-out for "AI Scheduled Monitors" (plan "Feature A —
 * Watchlist + AI Scheduled Monitors" §A4). Deliberately NOT `dispatchAlert`:
 * that helper always fans out to Telegram + push together with no per-call
 * channel selector, which conflicts with this feature's per-monitor
 * checkboxes. Instead this calls the same underlying primitives
 * `dispatchAlert` itself uses (`deliverSignal`, `sendPushToUser`) directly,
 * per-channel, keeping the general per-user preference gate
 * (`trading_settings.alerts_enabled` etc., enforced inside `deliverSignal`)
 * as an ADDITIONAL filter on top of the monitor's own channel choice, never
 * a replacement for it.
 *
 * SIGNAL HISTORY made this function the single choke point for a fire. Three
 * things now happen here that used to happen nowhere:
 *
 *  1. **The firing rule is applied.** `on_change` monitors stop before any
 *     channel is touched when the decision is the same one they last fired.
 *  2. **The event row is CLAIMED BEFORE delivery.** `claimSignalEvent` inserts
 *     against a unique `(monitor_id, bar_time, decision)` index; if the insert
 *     finds an existing row, this fire is a duplicate inside the same bar and
 *     nothing is sent. One row, one delivery — the persistence and the
 *     rate-limit are the same fact, so they cannot drift apart.
 *  3. **Per-channel outcomes are written back.** A failed Telegram send leaves
 *     `delivery.telegram = {status:"failed", error}` on a row that is already
 *     in the database, which is the difference between a signal history and a
 *     success-only log.
 *
 * Both new steps are ordered before the transports on purpose: a fire that is
 * suppressed must cost nothing, and a fire that is allowed must be recorded
 * even if every transport then fails.
 */
import { deliverSignal } from "@/lib/alerts";
import { sendPushToUser } from "@/lib/push";
import { recordAlert } from "@/lib/store";
import { createLogger } from "@/lib/logger";
import { deliverMonitorWebhook } from "@/lib/quantAgent/webhookDelivery";
import {
  claimSignalEvent,
  emptySignalDeliveryReport,
  recordSignalEventDelivery,
  type SignalDecision,
  type SignalDeliveryReport,
  type SignalEventRecord,
} from "@/lib/quantAgent/signalEventStore";
import { markMonitorDecisionFired, shouldFireForDecision, type MonitorRow } from "./monitorStore";

const log = createLogger("quantAgent.monitorNotify");

export interface MonitorNotificationPayload {
  /** Notification title — MUST say "Quant Agent" explicitly (plan §A4) so it
   * is never confused with a Lonora alert landing in the same Telegram
   * thread / push feed, e.g. "Quant Agent monitor — XAUUSD (1h)". */
  title: string;
  /** Telegram/push body text. */
  text: string;
  symbol: string;
  recommendationId: string;
  interval: string;
  direction: "buy" | "sell";
  entry: number | null;
  stopLoss: number;
  takeProfit: number | null;
  /**
   * Everything below is OPTIONAL so the existing cron caller keeps working
   * unchanged. Each one is recorded on the signal event when supplied and
   * simply absent when not — none of them is defaulted to a number, because a
   * fabricated confidence or a zero-filled level on a permanent record is
   * worse than a blank one.
   */
  market?: string;
  /** BUY/SELL when the caller has it; otherwise derived from `direction`. */
  decision?: SignalDecision;
  /** PERCENTAGE, 0-100 — not the service's 0.0-1.0 fraction. Converted by the caller. */
  confidence?: number | null;
  /** The engine's own reasoning. Falls back to the delivered message text. */
  rationale?: string | null;
  /** Close time of the bar this fire belongs to, epoch ms. */
  barTime?: number;
}

export interface MonitorNotificationOutcome {
  telegram: boolean;
  push: boolean;
  /** null = channel not enabled on this monitor, so it was never attempted. */
  webhook: boolean | null;
  /** The persisted signal-event id, or null when the fire was suppressed. */
  eventId: string | null;
  /**
   * Why nothing was delivered, when nothing was:
   * - `unchanged` — an `on_change` monitor whose decision did not change.
   * - `duplicate` — this (monitor, bar, decision) already fired and delivered.
   */
  suppressed: "unchanged" | "duplicate" | null;
}

/** BUY/SELL is the recorded vocabulary; buy/sell is the recommendation's. */
function decisionFor(payload: MonitorNotificationPayload): SignalDecision {
  if (payload.decision) return payload.decision;
  return payload.direction === "sell" ? "SELL" : "BUY";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Delivers a fired monitor's notification on every channel enabled on that
 * monitor row, then unconditionally records the attempt in `alert_log` —
 * mirrors `dispatchAlert`'s "the history write always happens" guarantee so
 * the in-app feed stays the one channel that never silently loses an event.
 */
export async function dispatchMonitorNotification(
  userId: number,
  monitor: MonitorRow,
  payload: MonitorNotificationPayload,
): Promise<MonitorNotificationOutcome> {
  const decision = decisionFor(payload);

  // (1) The rule, before anything is sent or written. A suppressed fire is
  // not an event: nothing happened that a user would want to read back.
  if (!shouldFireForDecision(monitor.fireRule, monitor.lastFiredDecision, decision)) {
    return { telegram: false, push: false, webhook: null, eventId: null, suppressed: "unchanged" };
  }

  // (2) Claim the bar. A `duplicate` claim means another sweep already
  // delivered this exact condition inside this exact bar.
  let event: SignalEventRecord | null = null;
  try {
    const claim = await claimSignalEvent(userId, {
      monitorId: monitor.id,
      symbol: payload.symbol,
      market: payload.market ?? monitor.market,
      interval: payload.interval,
      decision,
      direction: payload.direction,
      entryPrice: payload.entry,
      stopLoss: payload.stopLoss,
      takeProfit: payload.takeProfit,
      confidence: payload.confidence ?? null,
      rationale: payload.rationale ?? payload.text,
      fireRule: monitor.fireRule,
      previousDecision: monitor.lastFiredDecision,
      recommendationId: payload.recommendationId,
      barTime: payload.barTime,
    });
    if (!claim.claimed) {
      return { telegram: false, push: false, webhook: null, eventId: null, suppressed: "duplicate" };
    }
    event = claim.event;
  } catch (error) {
    // The log is the product surface, but it is not allowed to become a new
    // way for a real alert to go missing: if the claim itself fails (a DB
    // hiccup), fall through and deliver UNRECORDED rather than stay silent.
    // Only a genuine `duplicate` above may suppress a delivery.
    log.warn("quant_agent.monitor_notify.event_claim_failed", {
      monitorId: monitor.id,
      error: errorText(error),
    });
  }

  const delivery: SignalDeliveryReport = emptySignalDeliveryReport();
  let telegramDelivered = false;
  let pushDelivered = false;
  let webhookDelivered: boolean | null = null;

  if (monitor.notifyTelegram) {
    try {
      const result = await deliverSignal(userId, {
        type: "signal",
        title: payload.title,
        text: payload.text,
        symbol: payload.symbol,
      });
      telegramDelivered = result.delivered;
      delivery.telegram = result.delivered
        ? { status: "delivered" }
        : // `deliverSignal` returns a reason instead of throwing when the
          // user's own preferences or a missing Telegram link block it — that
          // reason is exactly what the history page needs to explain itself.
          { status: "failed", error: result.reason ?? "not_delivered" };
    } catch (error) {
      delivery.telegram = { status: "failed", error: errorText(error) };
      log.warn("quant_agent.monitor_notify.telegram_failed", {
        monitorId: monitor.id,
        error: errorText(error),
      });
    }
  }

  if (monitor.notifyPush) {
    try {
      const outcome = await sendPushToUser(userId, {
        title: payload.title,
        body: payload.text,
        url: `/chart?symbol=${encodeURIComponent(payload.symbol)}`,
        tag: `quant-agent-monitor-${monitor.id}`,
      });
      pushDelivered = outcome.sent > 0;
      delivery.push = pushDelivered
        ? { status: "delivered" }
        : {
            status: "failed",
            error: outcome.configured ? "no_active_subscription" : "push_not_configured",
          };
    } catch (error) {
      // Best-effort by design (same as dispatchAlert's push handling) — a
      // push transport failure never blocks Telegram/webhook or the log write.
      delivery.push = { status: "failed", error: errorText(error) };
      log.warn("quant_agent.monitor_notify.push_failed", {
        monitorId: monitor.id,
        error: errorText(error),
      });
    }
  }

  if (monitor.notifyWebhookUrl) {
    try {
      await deliverMonitorWebhook(monitor.notifyWebhookUrl, {
        monitor_id: String(monitor.id),
        symbol: payload.symbol,
        market: payload.market ?? monitor.market,
        interval: payload.interval,
        recommendation_id: payload.recommendationId,
        decision,
        direction: payload.direction,
        entry: payload.entry,
        stop_loss: payload.stopLoss,
        take_profit: payload.takeProfit,
        confidence: payload.confidence ?? null,
        rationale: payload.rationale ?? null,
        fire_rule: monitor.fireRule,
        signal_event_id: event?.id,
        fired_at: new Date().toISOString(),
      });
      webhookDelivered = true;
      delivery.webhook = { status: "delivered" };
    } catch (error) {
      webhookDelivered = false;
      delivery.webhook = { status: "failed", error: errorText(error) };
      log.warn("quant_agent.monitor_notify.webhook_failed", {
        monitorId: monitor.id,
        error: errorText(error),
      });
    }
  }

  if (event) {
    try {
      await recordSignalEventDelivery(event.id, delivery);
    } catch (error) {
      // The fire itself is already recorded; only the per-channel detail is
      // lost, and that is strictly better than losing the row.
      log.warn("quant_agent.monitor_notify.event_delivery_write_failed", {
        monitorId: monitor.id,
        eventId: event.id,
        error: errorText(error),
      });
    }
  }

  try {
    await markMonitorDecisionFired(monitor.id, decision);
  } catch (error) {
    log.warn("quant_agent.monitor_notify.decision_write_failed", {
      monitorId: monitor.id,
      error: errorText(error),
    });
  }

  try {
    await recordAlert(userId, {
      type: "quant_agent_monitor",
      title: payload.title,
      body: payload.text,
      symbol: payload.symbol,
      delivered: telegramDelivered || pushDelivered || webhookDelivered === true,
    });
  } catch (error) {
    // A transport failure is tolerated by design; a DB hiccup on this
    // "always works" write must not invert that. Log and continue.
    log.warn("quant_agent.monitor_notify.alert_log_failed", {
      monitorId: monitor.id,
      error: errorText(error),
    });
  }

  return {
    telegram: telegramDelivered,
    push: pushDelivered,
    webhook: webhookDelivered,
    eventId: event?.id ?? null,
    suppressed: null,
  };
}
