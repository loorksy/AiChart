import { getForexBackend } from "@/lib/brokers/forexBackend";
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
  const forexBackend = getForexBackend();
  return {
    user,
    settings: await getSettings(user.id),
    limits: await getLimits(user.id),
    binance: await getBinanceAccountMeta(user.id),
    ea: await getEaConnectionMeta(user.id),
    mt: forexBackend === "metaapi" ? await getMtAccountMeta(user.id) : null,
    forexBackend,
    canDownloadEa: hasPlatformAccess(user),
  };
}
