import { getPlatformValue } from "../platformConfig";

export type ForexBackendMode = "metaapi" | "ea";

/** Resolved forex execution backend (env override → MetaApi token → EA fallback). */
export function getForexBackend(): ForexBackendMode {
  const forced = process.env.FOREX_BACKEND?.trim().toLowerCase();
  if (forced === "ea" || forced === "mt_ea") return "ea";
  if (forced === "metaapi") return "metaapi";
  return getPlatformValue("METAAPI_TOKEN")?.trim() ? "metaapi" : "ea";
}

export function forexBrokerKind(): "metaapi" | "mt_ea" {
  return getForexBackend() === "metaapi" ? "metaapi" : "mt_ea";
}
