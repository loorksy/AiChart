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
 */
import { deliverSignal } from "@/lib/alerts";
import { sendPushToUser } from "@/lib/push";
import { recordAlert } from "@/lib/store";
import { createLogger } from "@/lib/logger";
import { deliverMonitorWebhook } from "@/lib/quantAgent/webhookDelivery";
import type { MonitorRow } from "./monitorStore";

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
}

export interface MonitorNotificationOutcome {
  telegram: boolean;
  push: boolean;
  /** null = channel not enabled on this monitor, so it was never attempted. */
  webhook: boolean | null;
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
    } catch (error) {
      log.warn("quant_agent.monitor_notify.telegram_failed", {
        monitorId: monitor.id,
        error: error instanceof Error ? error.message : String(error),
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
    } catch (error) {
      // Best-effort by design (same as dispatchAlert's push handling) — a
      // push transport failure never blocks Telegram/webhook or the log write.
      log.warn("quant_agent.monitor_notify.push_failed", {
        monitorId: monitor.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (monitor.notifyWebhookUrl) {
    try {
      await deliverMonitorWebhook(monitor.notifyWebhookUrl, {
        monitor_id: String(monitor.id),
        symbol: payload.symbol,
        interval: payload.interval,
        recommendation_id: payload.recommendationId,
        direction: payload.direction,
        entry: payload.entry,
        stop_loss: payload.stopLoss,
        take_profit: payload.takeProfit,
        fired_at: new Date().toISOString(),
      });
      webhookDelivered = true;
    } catch (error) {
      webhookDelivered = false;
      log.warn("quant_agent.monitor_notify.webhook_failed", {
        monitorId: monitor.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { telegram: telegramDelivered, push: pushDelivered, webhook: webhookDelivered };
}
