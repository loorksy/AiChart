import { isMt5LocalAvailable } from "@/lib/brokers/forexBackend";
import { isMt5BridgeConnectCapable } from "@/lib/mt5local/client";
import { isMetaApiConfiguredAsync } from "@/lib/metaapi/client";
import { metaapiUxEnabled } from "@/lib/metaapi/lifecycle";
import {
  getSettings,
  getLimits,
  getMtAccountMeta,
} from "@/lib/store";
import type { PublicUser } from "@/lib/types";

export async function loadConsoleSettingsProps(user: PublicUser) {
  const settings = await getSettings(user.id);
  const mt5BridgeConnect =
    isMt5LocalAvailable() && (await isMt5BridgeConnectCapable());
  const metaApiAvailable = await isMetaApiConfiguredAsync();
  return {
    user,
    settings,
    limits: await getLimits(user.id),
    mt: await getMtAccountMeta(user.id),
    /**
     * Whether to offer the MetaTrader linking wizard in the connections tab.
     * Deliberately the wizard's OWN gate, not metaApiAvailable: a token can be
     * present while the feature is still switched off, and a card gated on the
     * token would then hand the trader a button that lands on "not enabled".
     */
    mt5LinkEnabled: await metaapiUxEnabled(),
    /** The linked account, if any. */
    mt5Account: await getMtAccountMeta(user.id),
    mt5LocalAvailable: mt5BridgeConnect,
    metaApiAvailable,
    /** Server-side login: MetaApi cloud and/or native MT5 bridge. */
    platformConnectAvailable: metaApiAvailable || mt5BridgeConnect,
  };
}
