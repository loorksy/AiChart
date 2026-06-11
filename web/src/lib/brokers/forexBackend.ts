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
    return "mt5local";
  }
  if (process.env.MT5_BRIDGE_URL?.trim()) return "mt5local";
  return getPlatformValue("METAAPI_TOKEN")?.trim() ? "metaapi" : "ea";
}

export function forexBrokerKind(): "metaapi" | "mt_ea" | "mt5_local" {
  const backend = getForexBackend();
  if (backend === "metaapi") return "metaapi";
  if (backend === "mt5local") return "mt5_local";
  return "mt_ea";
}
