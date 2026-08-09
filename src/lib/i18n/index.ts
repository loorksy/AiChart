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
  let text =
    DICTIONARIES[locale]?.[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
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
  return acceptLanguage.toLowerCase().includes("en") ? "en" : "ar";
}
