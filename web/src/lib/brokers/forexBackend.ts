import { getPlatformValue } from "../platformConfig";

export type ForexBackendMode = "metaapi" | "ea" | "mt5local";

/**
 * Resolved forex execution backend:
 * env override → self-hosted MT5 bridge (MT5_BRIDGE_URL) → MetaApi token → EA.
 */
export function getForexBackend(): ForexBackendMode {
  const forced = process.env.FOREX_BACKEND?.trim().toLowerCase();
  if (forced === "ea" || forced === "mt_ea") return "ea";
  if (forced === "metaapi") return "metaapi";
  if (forced === "mt5local" || forced === "mt5_local" || forced === "local") {
    if (isMt5LocalAvailable()) return "mt5local";
    return getPlatformValue("METAAPI_TOKEN")?.trim() ? "metaapi" : "ea";
  }
  if (process.env.MT5_BRIDGE_URL?.trim()) return "mt5local";
  return getPlatformValue("METAAPI_TOKEN")?.trim() ? "metaapi" : "ea";
}

export function forexBrokerKind(): "metaapi" | "mt_ea" | "mt5_local" {
  return forexModeToBrokerKind(getForexBackend());
}

export function forexModeToBrokerKind(
  mode: ForexBackendMode,
): "metaapi" | "mt_ea" | "mt5_local" {
  if (mode === "metaapi") return "metaapi";
  if (mode === "mt5local") return "mt5_local";
  return "mt_ea";
}

/** Whether the self-hosted MT5 bridge is configured at the deployment level. */
export function isMt5LocalAvailable(): boolean {
  return Boolean(process.env.MT5_BRIDGE_URL?.trim());
}

/**
 * Resolve the effective forex backend honoring a per-user preference, falling
 * back to the global default when the user has none or their choice's
 * infrastructure isn't configured. EA needs no server infra so it is always
 * selectable; mt5local requires MT5_BRIDGE_URL; metaapi requires a token.
 * Pure (no DB) so it stays free of import cycles — callers pass the stored pref.
 */
export function resolveForexBackendFromPref(
  pref: string | null | undefined,
): ForexBackendMode {
  if (pref === "ea") return "ea";
  if (pref === "mt5local" && isMt5LocalAvailable()) return "mt5local";
  if (pref === "metaapi" && getPlatformValue("METAAPI_TOKEN")?.trim()) {
    return "metaapi";
  }
  return getForexBackend();
}
