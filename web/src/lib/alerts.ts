/**
 * Advanced alerts layer. Centralises the decision of whether a Telegram
 * notification should fire (based on per-user alert preferences) and records
 * every alert in the alert_log so the user has an in-app history.
 *
 * Two alert families are supported:
 *  - trade alerts  (executed / closed / failed)
 *  - signal alerts (new agent recommendations)
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
import type { AlertType } from "./types";

export type DeliveryReason =
  | "delivered"
  | "alerts_disabled"
  | "trade_alerts_disabled"
  | "signal_alerts_disabled"
  | "telegram_not_linked"
  | "bot_not_configured"
  | "delivery_failed"
  | "no_actionable_signal";

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
 * Decides whether an alert should be delivered to the user's Telegram given
 * their preferences, then sends it (best-effort) and logs it either way.
 */
export async function dispatchAlert(
  userId: number,
  opts: DispatchAlertOptions,
): Promise<DeliveryResult> {
  const result = await deliverSignal(userId, opts);

  await recordAlert(userId, {
    type: opts.type,
    title: opts.title,
    body: opts.text ?? null,
    symbol: opts.symbol ?? null,
    image_url: opts.photoUrl ?? null,
    delivered: result.delivered,
  });

  return result;
}
