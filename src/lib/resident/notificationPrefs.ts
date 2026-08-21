/**
 * The notification-preference VOCABULARY — deliberately pure.
 *
 * This module has ZERO imports so the browser can use it. The settings card
 * is a client component and must never drag the resident host (and with it
 * the database drivers, Redis, prom-client) into the browser bundle — that
 * is exactly the Turbopack build failure this split exists to prevent, and
 * the clientServerBoundary guard test pins it. Server-side logic (reading,
 * writing, delivering) lives in ./notifications, which re-exports these so
 * server callers keep one import site.
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

/** Merge unknown input onto the defaults, keeping only real booleans. */
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
