/**
 * Alerts layer. Decides whether a notification should fire (from per-user
 * preferences), fans it out to the enabled channels, and records every alert in
 * alert_log so the platform always has the history — delivered or not.
 *
 * Three channels, one decision: Telegram, browser/mobile push, and the in-app
 * feed that reads alert_log. They are deliberately independent at delivery
 * time: an unlinked Telegram or an absent VAPID key must not silence the
 * others, and no channel failure is ever allowed to lose the record.
 *
 * Two alert families are supported:
 *  - trade alerts  (executed / closed / failed)
 *  - signal alerts (new agent recommendations, lifecycle changes)
 */

import { getSettings, getRecommendation, recordAlert, getTelegramChatId } from "./store";
import {
  notifyUser,
  notifyUserPhoto,
  notifyUserPhotoBuffer,
  isTelegramConfigured,
  type InlineButton,
} from "./telegram";
import { buildChartSnapshotBuffer } from "./chartSnapshot";
import { overlaysFromRecommendation } from "./chartOverlays";
import { parseChartDrawingsJson } from "./chartDrawings";
import { sendPushToUser } from "./push";
import type { AlertType } from "./types";
import { createLogger } from "./logger";

const log = createLogger("alerts");

export type DeliveryReason =
  | "delivered"
  | "alerts_disabled"
  | "trade_alerts_disabled"
  | "signal_alerts_disabled"
  | "telegram_not_linked"
  | "bot_not_configured"
  | "delivery_failed"
  | "no_actionable_signal"
  /** Creation already announced through the lifecycle notifier's dedupe. */
  | "duplicate_creation_alert"
  /** Lifecycle alerts flag / silent rollout window suppressed sending. */
  | "silent_mode"
  /** Per-symbol rate cap suppressed a non-terminal creation alert. */
  | "rate_limited";

export interface DeliveryResult {
  delivered: boolean;
  reason?: DeliveryReason;
  reasonAr?: string;
}

const REASON_AR: Record<DeliveryReason, string> = {
  delivered: "أُرسل إلى تليجرام",
  alerts_disabled: "التنبيهات معطّلة في الإعدادات",
  trade_alerts_disabled: "تنبيهات الصفقات معطّلة",
  signal_alerts_disabled: "تنبيهات الإشارات معطّلة",
  telegram_not_linked: "تليجرام غير مربوط",
  bot_not_configured: "بوت تليجرام غير مُعدّ",
  delivery_failed: "فشل الإرسال إلى تليجرام",
  no_actionable_signal: "لا إشارة تنفيذية",
  duplicate_creation_alert: "أُعلنت هذه التوصية من قبل",
  silent_mode: "وضع صامت — سُجِّل دون إرسال",
  rate_limited: "تجاوز حد التنبيهات للرمز",
};

export function deliveryReasonAr(reason?: DeliveryReason): string {
  if (!reason) return "";
  return REASON_AR[reason] ?? reason;
}

export interface DispatchAlertOptions {
  type: AlertType;
  /** Short headline stored in the alert history. */
  title: string;
  /** Telegram message body (HTML). Falls back to title when omitted. */
  text?: string;
  symbol?: string | null;
  /** Optional chart image to send instead of a plain message. */
  photoUrl?: string | null;
  buttons?: InlineButton[][];
}

function isTradeAlert(type: AlertType): boolean {
  return (
    type === "trade_executed" ||
    type === "trade_closed" ||
    type === "trade_failed"
  );
}

export interface DeliveryGateResult {
  allowed: boolean;
  reason?: DeliveryReason;
  reasonAr?: string;
}

/**
 * Evaluates user settings + Telegram linkage without sending.
 */
export async function evaluateDelivery(
  userId: number,
  opts: DispatchAlertOptions,
): Promise<DeliveryGateResult> {
  const settings = await getSettings(userId);

  if (settings.alerts_enabled !== 1) {
    return {
      allowed: false,
      reason: "alerts_disabled",
      reasonAr: REASON_AR.alerts_disabled,
    };
  }

  if (isTradeAlert(opts.type) && settings.alert_trades !== 1) {
    return {
      allowed: false,
      reason: "trade_alerts_disabled",
      reasonAr: REASON_AR.trade_alerts_disabled,
    };
  }

  if (opts.type === "signal") {
    if (settings.alert_signals !== 1) {
      return {
        allowed: false,
        reason: "signal_alerts_disabled",
        reasonAr: REASON_AR.signal_alerts_disabled,
      };
    }
  }

  if (!isTelegramConfigured()) {
    return {
      allowed: false,
      reason: "bot_not_configured",
      reasonAr: REASON_AR.bot_not_configured,
    };
  }

  const chatId = await getTelegramChatId(userId);
  if (!chatId) {
    return {
      allowed: false,
      reason: "telegram_not_linked",
      reasonAr: REASON_AR.telegram_not_linked,
    };
  }

  return { allowed: true };
}

/**
 * Unified Telegram delivery gate — applies preferences and sends best-effort.
 */
export async function deliverSignal(
  userId: number,
  opts: DispatchAlertOptions,
): Promise<DeliveryResult> {
  const gate = await evaluateDelivery(userId, opts);
  if (!gate.allowed) {
    return {
      delivered: false,
      reason: gate.reason,
      reasonAr: gate.reasonAr,
    };
  }

  const body = opts.text ?? opts.title;

  try {
    if (opts.photoUrl?.startsWith("/api/chart-image/")) {
      const recId = Number(opts.photoUrl.split("/").pop());
      const rec =
        Number.isFinite(recId) && recId > 0
          ? await getRecommendation(recId)
          : null;
      const settings = await getSettings(userId);
      if (rec && settings.send_screenshot === 1) {
        const buffer = await buildChartSnapshotBuffer({
          symbol: rec.symbol,
          interval: rec.timeframe ?? "1h",
          overlays: overlaysFromRecommendation(rec),
          drawings: parseChartDrawingsJson(rec.chart_drawings_json),
          patternName: rec.pattern_name,
        });
        if (buffer) {
          await notifyUserPhotoBuffer(userId, buffer, body, opts.buttons);
        } else {
          await notifyUser(userId, body, opts.buttons);
        }
      } else {
        await notifyUser(userId, body, opts.buttons);
      }
    } else if (opts.photoUrl) {
      await notifyUserPhoto(userId, opts.photoUrl, body, opts.buttons);
    } else {
      await notifyUser(userId, body, opts.buttons);
    }
    return {
      delivered: true,
      reason: "delivered",
      reasonAr: REASON_AR.delivered,
    };
  } catch (e) {
    console.error("[alerts] delivery failed", e);
    return {
      delivered: false,
      reason: "delivery_failed",
      reasonAr: REASON_AR.delivery_failed,
    };
  }
}

/**
 * Deliver an alert on every enabled channel and record it either way.
 *
 * The alert_log write is unconditional on purpose: whether or not Telegram is
 * linked or push is configured, the in-app feed is the channel that always
 * works, and losing the record because a transport was down would be the one
 * unrecoverable failure here.
 */
export async function dispatchAlert(
  userId: number,
  opts: DispatchAlertOptions,
): Promise<DeliveryResult> {
  const result = await deliverSignal(userId, opts);

  // Push runs independently of the Telegram outcome: a user with no Telegram
  // link should still get the notification on their phone.
  let pushed = false;
  try {
    const settings = await getSettings(userId);
    const pushAllowed =
      settings.alerts_enabled === 1 &&
      (settings.alert_push ?? 1) === 1 &&
      (opts.type !== "signal" || settings.alert_signals === 1);
    if (pushAllowed) {
      const outcome = await sendPushToUser(userId, {
        title: opts.title,
        body: opts.text ?? opts.title,
        url: opts.symbol ? `/chart?symbol=${encodeURIComponent(opts.symbol)}` : "/",
        tag: opts.symbol ?? opts.type,
      });
      pushed = outcome.sent > 0;
    }
  } catch {
    // Best-effort by design — never let a push transport failure change the
    // Telegram result or block the history write below.
  }

  try {
    await recordAlert(userId, {
      type: opts.type,
      title: opts.title,
      body: opts.text ?? null,
      symbol: opts.symbol ?? null,
      image_url: opts.photoUrl ?? null,
      delivered: result.delivered || pushed,
    });
  } catch (error) {
    // A transport failure is tolerated by design (see the comment above); a DB
    // hiccup on this "always works" write must not invert that and report an
    // already-delivered message as failed. Log and continue.
    log.warn("failed to record alert_log entry", {
      userId,
      type: opts.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return pushed && !result.delivered
    ? { delivered: true, reason: "delivered", reasonAr: REASON_AR.delivered }
    : result;
}
