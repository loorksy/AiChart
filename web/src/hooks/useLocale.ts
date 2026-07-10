"use client";

/**
 * Shared locale hook. Re-exports the reactive locale context so any component
 * (sidebar, chat, profile menu, future MCP cards / voice) can read the current
 * locale, direction, translator, and switchers from one place.
 *
 * For non-React contexts (server, MCP card renderers, tests) use the pure
 * helpers in `@/lib/i18n` (`t`, `dirForLocale`, `getLocale`, `setLocale`).
 */
export { useLocale } from "@/components/LocaleProvider";
export type { AppLocale, Direction } from "@/lib/i18n";
