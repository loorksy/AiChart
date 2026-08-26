/**
 * Compact human durations for the tracking record — e.g. "3h 20m" and its
 * Arabic equivalent. Two units at most: the largest one and its immediate
 * neighbour, because a card that shows four units reads like a stopwatch,
 * not a record. Unit letters live in the i18n dictionaries with every other
 * user-facing string.
 */
import { t, type AppLocale } from "@/lib/i18n";

export function formatDurationMs(
  ms: number | null | undefined,
  locale: AppLocale = "ar",
): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const day = t(locale, "duration.unit.day");
  const hour = t(locale, "duration.unit.hour");
  const minute = t(locale, "duration.unit.minute");
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `<1${minute}`;
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}${day} ${hours}${hour}` : `${days}${day}`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}${hour} ${minutes}${minute}` : `${hours}${hour}`;
  }
  return `${totalMinutes}${minute}`;
}
