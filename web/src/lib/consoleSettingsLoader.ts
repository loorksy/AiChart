import {
  isMt5LocalAvailable,
  resolveForexBackendFromPref,
} from "@/lib/brokers/forexBackend";
import { isMt5BridgeConnectCapable } from "@/lib/mt5local/client";
import {
  getSettings,
  getLimits,
  getBinanceAccountMeta,
  getMtAccountMeta,
} from "@/lib/store";
import { getEaConnectionMeta } from "@/lib/eaStore";
import { hasPlatformAccess } from "@/lib/platformAccess";
import type { PublicUser } from "@/lib/types";

export async function loadConsoleSettingsProps(user: PublicUser) {
  const settings = await getSettings(user.id);
  // Per-user choice (EA vs server-side platform) → resolved effective backend.
  const forexBackend = resolveForexBackendFromPref(settings.forex_backend);
  const usesMtAccount = forexBackend === "metaapi" || forexBackend === "mt5local";
  return {
    user,
    settings,
    limits: await getLimits(user.id),
    binance: await getBinanceAccountMeta(user.id),
    ea: await getEaConnectionMeta(user.id),
    mt: usesMtAccount ? await getMtAccountMeta(user.id) : null,
    forexBackend,
    // Whether the operator configured a working self-hosted MT5 bridge — gates
    // the "connect through the platform" option in the UI.
    mt5LocalAvailable:
      isMt5LocalAvailable() && (await isMt5BridgeConnectCapable()),
    canDownloadEa: hasPlatformAccess(user),
  };
}
