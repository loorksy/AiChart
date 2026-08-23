/** App locale + text-direction primitives shared across UI, MCP cards, and voice. */
export type AppLocale = "ar" | "en";

/** Backwards-compatible alias for existing `Locale` imports. */
export type Locale = AppLocale;

export type Direction = "rtl" | "ltr";

export const APP_LOCALES: readonly AppLocale[] = ["ar", "en"] as const;

/**
 * English is the platform default on every surface — web, Telegram, MCP.
 * A user who has never chosen gets English; the switcher (and the bot's
 * language command) changes it for their whole account, not per channel.
 */
export const DEFAULT_LOCALE: AppLocale = "en";

/** localStorage key. Kept as the historical value so existing prefs carry over. */
export const LOCALE_STORAGE_KEY = "aichart-locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "ar" || value === "en";
}
