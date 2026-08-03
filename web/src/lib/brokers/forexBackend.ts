import { getPlatformValue } from "../platformConfig";

export type ForexBackendMode = "metaapi" | "mt5local";

/**
 * Resolved forex execution backend: self-hosted MT5 bridge (MT5_BRIDGE_URL)
 * takes priority, then a MetaApi token. There is no silent third option — a
 * deployment with neither configured, or one still carrying the retired
 * FOREX_BACKEND=ea/mt_ea, throws instead of guessing. The old code fell back
 * to "ea" here whenever nothing else was configured, which is exactly how a
 * stale VPS .env would have gone unnoticed post-removal.
 */
export function getForexBackend(): ForexBackendMode {
  const forced = process.env.FOREX_BACKEND?.trim().toLowerCase();
  if (forced === "ea" || forced === "mt_ea") {
    throw new Error(
      "FOREX_BACKEND=ea is no longer supported — the EA bridge was removed. " +
        "Set FOREX_BACKEND=mt5local or metaapi, or unset it to auto-detect from MT5_BRIDGE_URL/METAAPI_TOKEN.",
    );
  }
  if (forced === "metaapi") return "metaapi";
  if (forced === "mt5local" || forced === "mt5_local" || forced === "local") {
    if (isMt5LocalAvailable()) return "mt5local";
    if (getPlatformValue("METAAPI_TOKEN")?.trim()) return "metaapi";
    throw new Error(
      "FOREX_BACKEND=mt5local but MT5_BRIDGE_URL is not configured, and no METAAPI_TOKEN fallback is set either.",
    );
  }
  if (process.env.MT5_BRIDGE_URL?.trim()) return "mt5local";
  if (getPlatformValue("METAAPI_TOKEN")?.trim()) return "metaapi";
  throw new Error(
    "No forex backend configured — set MT5_BRIDGE_URL or METAAPI_TOKEN (or FOREX_BACKEND to pick one explicitly).",
  );
}

export function forexBrokerKind(): "metaapi" | "mt5_local" {
  return forexModeToBrokerKind(getForexBackend());
}

export function forexModeToBrokerKind(
  mode: ForexBackendMode,
): "metaapi" | "mt5_local" {
  return mode === "metaapi" ? "metaapi" : "mt5_local";
}

/** Whether the self-hosted MT5 bridge is configured at the deployment level. */
export function isMt5LocalAvailable(): boolean {
  return Boolean(process.env.MT5_BRIDGE_URL?.trim());
}

/**
 * Resolve the effective forex backend honoring a per-user preference, falling
 * back to the global default when the user has none, their choice's
 * infrastructure isn't configured, or the preference is a legacy value (the
 * migration rewrites stored 'ea' rows to NULL, but resolution must not depend
 * on that migration having already run — an unmigrated row falls through to
 * the deployment default exactly like an unset preference does).
 * Pure (no DB) so it stays free of import cycles — callers pass the stored pref.
 */
export function resolveForexBackendFromPref(
  pref: string | null | undefined,
): ForexBackendMode {
  if (pref === "mt5local" && isMt5LocalAvailable()) return "mt5local";
  if (pref === "metaapi" && getPlatformValue("METAAPI_TOKEN")?.trim()) {
    return "metaapi";
  }
  return getForexBackend();
}
