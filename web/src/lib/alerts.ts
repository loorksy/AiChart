/**
 * Advanced alerts layer. Centralises the decision of whether a Telegram
 * notification should fire (based on per-user alert preferences) and records
 * every alert in the alert_log so the user has an in-app history.
 *
 * Two alert families are supported:
 *  - trade alerts  (executed / closed / failed)
 *  - signal alerts (new agent recommendations), gated by a confidence floor
 */

import { getSettings, recordAlert, getTelegramChatId } from "./store";
import {
  notifyUser,
  notifyUserPhoto,
  isTelegramConfigured,
  type InlineButton,
} from "./telegram";
import type { AlertType } from "./types";

export interface DispatchAlertOptions {
  type: AlertType;
  /** Short headline stored in the alert history. */
  title: string;
  /** Telegram message body (HTML). Falls back to title when omitted. */
  text?: string;
  symbol?: string | null;
  /** Signal-only: recommendation confidence used for threshold gating. */
  confidence?: number;
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

/**
 * Decides whether an alert should be delivered to the user's Telegram given
 * their preferences, then sends it (best-effort) and logs it either way.
 */
export async function dispatchAlert(
  userId: number,
  opts: DispatchAlertOptions,
): Promise<void> {
  const settings = await getSettings(userId);

  // Master switch.
  let allowed = settings.alerts_enabled === 1;

  if (allowed && isTradeAlert(opts.type)) {
    allowed = settings.alert_trades === 1;
  }

  if (allowed && opts.type === "signal") {
    allowed = settings.alert_signals === 1;
    if (
      allowed &&
      typeof opts.confidence === "number" &&
      opts.confidence < settings.alert_min_confidence
    ) {
      allowed = false;
    }
  }

  let delivered = false;
  if (allowed) {
    const body = opts.text ?? opts.title;
    // Only count as delivered when Telegram is configured and the user has a
    // linked chat; the notify* helpers no-op silently otherwise.
    const chatId = await getTelegramChatId(userId);
    const canDeliver = isTelegramConfigured() && Boolean(chatId);
    if (canDeliver) {
      try {
        if (opts.photoUrl) {
          await notifyUserPhoto(userId, opts.photoUrl, body, opts.buttons);
        } else {
          await notifyUser(userId, body, opts.buttons);
        }
        delivered = true;
      } catch (e) {
        console.error("[alerts] delivery failed", e);
        delivered = false;
      }
    }
  }

  await recordAlert(userId, {
    type: opts.type,
    title: opts.title,
    body: opts.text ?? null,
    symbol: opts.symbol ?? null,
    delivered,
  });
}
