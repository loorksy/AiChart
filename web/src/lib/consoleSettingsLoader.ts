import {
  isMt5LocalAvailable,
  resolveForexBackendFromPref,
} from "@/lib/brokers/forexBackend";
import { isMt5BridgeConnectCapable } from "@/lib/mt5local/client";
import { isMetaApiConfiguredAsync } from "@/lib/metaapi/client";
import {
  getSettings,
  getLimits,
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
  const mt5BridgeConnect =
    isMt5LocalAvailable() && (await isMt5BridgeConnectCapable());
  const metaApiAvailable = await isMetaApiConfiguredAsync();
  return {
    user,
    settings,
    limits: await getLimits(user.id),
    ea: await getEaConnectionMeta(user.id),
    mt: usesMtAccount ? await getMtAccountMeta(user.id) : null,
    forexBackend,
    mt5LocalAvailable: mt5BridgeConnect,
    metaApiAvailable,
    /** Server-side login without EA: MetaApi cloud and/or native MT5 bridge. */
    platformConnectAvailable: metaApiAvailable || mt5BridgeConnect,
    canDownloadEa: hasPlatformAccess(user),
  };
}
