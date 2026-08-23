/**
 * Small, framework-free i18n core. Pure functions here are safe to use from
 * anywhere — React components, MCP card renderers, voice session code, the
 * server, and tests. React reactivity lives in `LocaleProvider` / `useLocale`,
 * which read their dictionary and direction from this module.
 */
import { ar } from "./ar";
import { en, type TranslationKey } from "./en";
import {
  APP_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isAppLocale,
  type AppLocale,
  type Direction,
  type Locale,
} from "./types";

export type { AppLocale, Locale, Direction, TranslationKey };
export { APP_LOCALES, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, isAppLocale };

const DICTIONARIES: Record<AppLocale, Record<string, string>> = { ar, en };

/**
 * Keys asked for that the requested locale does not carry.
 *
 * A missing translation used to fall through to the other locale (or to the
 * raw dotted key) with nothing recorded anywhere, so a half-translated
 * surface looked exactly like a finished one. Tests assert this set is
 * empty; at runtime the miss is logged once per key rather than repeatedly.
 */
const missingKeys = new Set<string>();

function reportMissingKey(locale: AppLocale, key: string): void {
  const id = `${locale}:${key}`;
  if (missingKeys.has(id)) return;
  missingKeys.add(id);
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[i18n] missing key "${key}" for locale "${locale}"`);
  }
}

/** Test seam: every (locale, key) miss seen so far. */
export function missingTranslationKeys(): string[] {
  return [...missingKeys];
}

export function clearMissingTranslationKeys(): void {
  missingKeys.clear();
}

/** Text direction for a locale. */
export function dirForLocale(locale: AppLocale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

/** All messages for a locale (used by the React provider + MCP cards). */
export function messagesFor(locale: AppLocale): Record<string, string> {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/**
 * Translate a key in a locale. Falls back to the default-locale value, then to
 * the raw key, so a missing key is always safe (never throws / never blank).
 * Supports `{name}`-style interpolation.
 */
export function t(
  locale: AppLocale,
  key: TranslationKey | string,
  replacements?: Record<string, string>,
): string {
  const direct = DICTIONARIES[locale]?.[key];
  let text = direct ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  if (direct === undefined) {
    // A missing key must never be a silent shrug. In production the raw key
    // still renders (an ugly label beats a blank screen or a throw), but the
    // miss is reported so the parity test and the console both catch it —
    // the alternative is a dotted key quietly shipping to users.
    reportMissingKey(locale, String(key));
  }
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return text;
}

/** The other locale (used by the toggle). */
export function toggleLocale(locale: AppLocale): AppLocale {
  return locale === "ar" ? "en" : "ar";
}

/**
 * Read the persisted locale, falling back to the device's language on a first
 * visit. Must agree with LocaleProvider's fallback — TvChart and the voice
 * bridge boot from here, and a platform in one language with a chart in
 * another is exactly the bug this fallback exists to prevent.
 */
export function getLocale(): AppLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isAppLocale(stored)) return stored;
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  return candidates.some((tag) => tag?.toLowerCase().startsWith("ar")) ? "ar" : "en";
}

/** Persist the locale and reflect it on <html> (dir + lang) immediately. */
export function setLocale(locale: AppLocale): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  if (typeof document !== "undefined") {
    document.documentElement.dir = dirForLocale(locale);
    document.documentElement.lang = locale;
  }
}

/** Best-effort locale from an Accept-Language header (server-side default). */
export function detectLocale(acceptLanguage?: string | null): AppLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  // Only an explicit Arabic request gets Arabic. Treating "anything that is
  // not English" as Arabic handed Arabic to a French or German visitor; the
  // platform default is the honest answer when the hint says neither.
  return /(^|[,\s])ar\b|-ar\b/i.test(acceptLanguage) ? "ar" : DEFAULT_LOCALE;
}
