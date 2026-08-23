/**
 * Shared MCP locale resolution — framework-free, safe for server tools,
 * resource templates, and card-runtime code (no React). Normalizes locale
 * variants (ar-SA, en-GB, …) to "ar" | "en" and applies a fixed precedence,
 * defaulting to English — the platform default on every surface. Never
 * guesses the locale from symbols or market data.
 *
 * The ACCOUNT's saved language is what the platform bridge supplies here, so
 * a user who switches language on the web sees MCP answer in it too. Tool
 * DESCRIPTIONS are deliberately not localized: the model reads those, not
 * the user.
 */
export type McpLocale = "ar" | "en";
export type McpDirection = "rtl" | "ltr";

export const DEFAULT_MCP_LOCALE: McpLocale = "en";

/** Normalize a raw locale value to "ar" | "en", or null when unrecognized. */
export function normalizeLocale(value: unknown): McpLocale | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase().replace("_", "-");
  if (!v) return null;
  if (v === "ar" || v.startsWith("ar-")) return "ar";
  if (v === "en" || v.startsWith("en-")) return "en";
  // Bare 2-letter fallback (e.g. "arb" is not standard; keep strict-ish).
  if (v.slice(0, 2) === "ar") return "ar";
  if (v.slice(0, 2) === "en") return "en";
  return null;
}

export interface McpLocaleSources {
  /** 1) Explicit locale passed by the tool call / card payload. */
  explicit?: unknown;
  /** 2) User/account saved locale. */
  account?: unknown;
  /** 3) MCP request / client locale metadata. */
  request?: unknown;
  /** 4) Host or browser language, when safely available. */
  host?: unknown;
}

/** Resolve the effective locale by precedence, defaulting to English. */
export function resolveMcpLocale(sources: McpLocaleSources): McpLocale {
  const ordered = [
    sources.explicit,
    sources.account,
    sources.request,
    sources.host,
  ];
  for (const candidate of ordered) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_MCP_LOCALE;
}

export function dirForMcpLocale(locale: McpLocale): McpDirection {
  return locale === "ar" ? "rtl" : "ltr";
}
