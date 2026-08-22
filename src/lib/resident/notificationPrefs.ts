/**
 * The notification-preference VOCABULARY — categories, the prefs shape, the
 * defaults, and the normalizer. Deliberately a pure module with zero imports:
 * the browser settings card renders this vocabulary, and a "use client"
 * component must be able to name it without dragging the resident host (and
 * through it the DB drivers, the queue, the Telegram adapter) into the client
 * bundle. That exact chain is what broke the production build.
 *
 * Delivery, persistence, and everything with a side effect stays in
 * ./notifications, which re-exports these names for server callers.
 */

export const NOTIFICATION_CATEGORIES = [
  "activation",
  "target",
  "invalidation",
  "news_block",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationPrefs = Record<NotificationCategory, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  activation: true,
  target: true,
  invalidation: true,
  news_block: true,
};

/** Unknown keys dropped, non-booleans ignored, absent categories defaulted on. */
export function normalizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS };
  if (raw && typeof raw === "object") {
    for (const category of NOTIFICATION_CATEGORIES) {
      const value = (raw as Record<string, unknown>)[category];
      if (typeof value === "boolean") prefs[category] = value;
    }
  }
  return prefs;
}
