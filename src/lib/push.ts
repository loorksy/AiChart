/**
 * Browser and mobile push — the third notification channel
 * (docs/UNIFIED_AGENT_PLAN.md §14).
 *
 * Telegram reaches the operator's phone but only if they keep it open; the
 * in-app history only helps someone already looking at the screen. Web push is
 * what reaches a closed tab, which is where a plan usually activates.
 *
 * Unconfigured is a normal state, not an error: without VAPID keys this module
 * reports that it is off and every caller carries on. The other channels are
 * never held up by a push failure.
 */
import webpush from "web-push";
import { execute, query } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("push");

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

interface SubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured: boolean | null = null;

/** Are VAPID keys present? Cached per process; absence is not an error. */
export function isPushConfigured(): boolean {
  if (configured != null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:alerts@aichart.app";
  if (!publicKey || !privateKey) {
    configured = false;
    return configured;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (error) {
    log.warn("push.vapid.invalid", {
      error: error instanceof Error ? error.name : "unknown",
    });
    configured = false;
  }
  return configured;
}

/** The public key the browser needs to subscribe. Null when push is off. */
export function pushPublicKey(): string | null {
  return isPushConfigured() ? (process.env.VAPID_PUBLIC_KEY?.trim() ?? null) : null;
}

export async function savePushSubscription(
  userId: number,
  input: PushSubscriptionInput,
): Promise<void> {
  // Re-subscribing from the same device must not accumulate rows, and an
  // endpoint that moves between accounts belongs to the newest one.
  await execute("DELETE FROM push_subscriptions WHERE endpoint = ?", [input.endpoint]);
  await execute(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?,?,?,?,?,?)`,
    [
      userId,
      input.endpoint,
      input.keys.p256dh,
      input.keys.auth,
      input.userAgent ?? null,
      Date.now(),
    ],
  );
}

export async function removePushSubscription(
  userId: number,
  endpoint: string,
): Promise<void> {
  await execute("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", [
    userId,
    endpoint,
  ]);
}

export async function countPushSubscriptions(userId: number): Promise<number> {
  const rows = await query<{ endpoint: string }>(
    "SELECT endpoint FROM push_subscriptions WHERE user_id = ?",
    [userId],
  ).catch(() => []);
  return rows.length;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link opened when the notification is clicked. */
  url?: string;
  /** Collapse key so a device shows one card per plan, not a stack. */
  tag?: string;
}

export interface PushResult {
  sent: number;
  removed: number;
  configured: boolean;
}

/**
 * Send to every device this operator registered.
 *
 * A 404/410 means the browser has permanently discarded the subscription, so
 * the row is deleted rather than retried — otherwise a stale endpoint is
 * attempted on every future alert forever.
 */
export async function sendPushToUser(
  userId: number,
  payload: PushPayload,
): Promise<PushResult> {
  if (!isPushConfigured()) return { sent: 0, removed: 0, configured: false };

  const rows = await query<SubscriptionRow>(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    [userId],
  ).catch(() => []);
  if (!rows.length) return { sent: 0, removed: 0, configured: true };

  let sent = 0;
  let removed = 0;
  const body = JSON.stringify(payload);

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body,
      );
      sent += 1;
      await execute("UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?", [
        Date.now(),
        row.id,
      ]).catch(() => undefined);
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await execute("DELETE FROM push_subscriptions WHERE id = ?", [row.id]).catch(
          () => undefined,
        );
        removed += 1;
      } else {
        log.warn("push.send.failed", { status: status ?? 0 });
      }
    }
  }

  return { sent, removed, configured: true };
}
