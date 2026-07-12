/** App locale + text-direction primitives shared across UI, MCP cards, and voice. */
export type AppLocale = "ar" | "en";

/** Backwards-compatible alias for existing `Locale` imports. */
export type Locale = AppLocale;

export type Direction = "rtl" | "ltr";

export const APP_LOCALES: readonly AppLocale[] = ["ar", "en"] as const;

export const DEFAULT_LOCALE: AppLocale = "ar";

/** localStorage key. Kept as the historical value so existing prefs carry over. */
export const LOCALE_STORAGE_KEY = "aichart-locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "ar" || value === "en";
}
