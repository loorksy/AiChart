/**
 * RTL-safe message timestamps — the one formatter for "when did this happen"
 * on a chat surface.
 *
 * The support thread used to build its own format with bare numeric fields
 * ("26/08" + clock + Arabic AM/PM word). The Arabic date pattern inserts an
 * Arabic-letter mark before the slash, so the moment that string sat inside
 * an RTL paragraph the bidi algorithm tore it apart and reassembled the
 * pieces visually with the day digits thrown to the far end ("/08, 03:04
 * <am>26"). Two rules make the output unbreakable:
 *
 *  1. Arabic dates never mix bare digits with slashes — the month is a WORD
 *     (day + month name) or the whole day is a word (today / yesterday);
 *  2. every formatted fragment is wrapped in a first-strong bidi isolate
 *     (U+2068 … U+2069), so the surrounding paragraph — whatever its
 *     direction — can never reorder the fragment's insides.
 */
import { t, type AppLocale } from "@/lib/i18n";

const FSI = "\u2068"; // FIRST STRONG ISOLATE
const PDI = "\u2069"; // POP DIRECTIONAL ISOLATE

const DAY_MS = 86_400_000;

/**
 * Wrap one already-formatted fragment in a first-strong isolate. Invisible on
 * screen; to the bidi algorithm it is a wall.
 */
export function bidiIsolate(text: string): string {
  return text ? `${FSI}${text}${PDI}` : text;
}

/**
 * Explicit formatter tags so every runtime resolves the same way: Arabic gets
 * Arabic-Indic digits (U+0660-0669) and Arabic month/day-period words;
 * English gets Latin digits. A bare "ar" resolves per the HOST's region data
 * and can come back with Latin digits on one device and Arabic on another.
 */
function formatterTag(locale: AppLocale): string {
  return locale === "ar" ? "ar-EG-u-nu-arab" : "en-US";
}

type DayFormatters = {
  clock: Intl.DateTimeFormat;
  sameYear: Intl.DateTimeFormat;
  otherYear: Intl.DateTimeFormat;
};

const FORMATTERS = new Map<AppLocale, DayFormatters>();

function formattersFor(locale: AppLocale): DayFormatters {
  let f = FORMATTERS.get(locale);
  if (!f) {
    const tag = formatterTag(locale);
    f = {
      clock: new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }),
      // month: "long", never numeric — a wordy month cannot be mistaken for
      // the day and gives the bidi algorithm nothing to scramble.
      sameYear: new Intl.DateTimeFormat(tag, { day: "numeric", month: "long" }),
      otherYear: new Intl.DateTimeFormat(tag, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    };
    FORMATTERS.set(locale, f);
  }
  return f;
}

export function isSameCalendarDay(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** The time of day ("03:04 AM" and its Arabic equivalent), isolated. */
export function formatClock(ts: number, locale: AppLocale): string {
  if (!Number.isFinite(ts)) return "";
  return bidiIsolate(formattersFor(locale).clock.format(new Date(ts)));
}

/**
 * The day, as a reader says it: today, yesterday, then day + wordy month,
 * with the year only once the year differs. Feeds the chat's date separators.
 */
export function formatDayLabel(
  ts: number,
  locale: AppLocale,
  now: number = Date.now(),
): string {
  if (!Number.isFinite(ts)) return "";
  if (isSameCalendarDay(ts, now)) return t(locale, "time.today");
  if (isSameCalendarDay(ts, now - DAY_MS)) return t(locale, "time.yesterday");
  const f = formattersFor(locale);
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return bidiIsolate((sameYear ? f.sameYear : f.otherYear).format(new Date(ts)));
}

/**
 * One-line stamp for a message or list row: "today + clock", or "day +
 * month name, clock" for older days. Day and clock are isolated separately,
 * so even the joining comma cannot pull them out of order.
 */
export function formatMessageStamp(
  ts: number,
  locale: AppLocale,
  now: number = Date.now(),
): string {
  if (!Number.isFinite(ts)) return "";
  const day = formatDayLabel(ts, locale, now);
  const clock = formatClock(ts, locale);
  const relative = isSameCalendarDay(ts, now) || isSameCalendarDay(ts, now - DAY_MS);
  // U+060C is the Arabic comma, escaped so the Arabic-ratchet guard (which
  // keeps Arabic STRINGS in the dictionaries) does not read it as copy.
  const separator = relative ? " " : locale === "ar" ? "\u060C " : ", ";
  return `${day}${separator}${clock}`;
}

/** A full wordy date ("September 22, 2026" and its Arabic equivalent) for renewal/expiry lines. */
export function formatFullDate(ts: number, locale: AppLocale): string {
  if (!Number.isFinite(ts)) return "";
  return bidiIsolate(formattersFor(locale).otherYear.format(new Date(ts)));
}
