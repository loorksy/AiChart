import {
  getAdminPlatformStats,
  getBinanceAccountMeta,
  getSettings,
  isMasterKillOn,
  listIntents,
} from "@/lib/store";
import { getForexConnectionView } from "@/lib/forexConnection";
import { getCurrentUser } from "@/lib/auth";
import { BridgeOverviewClient } from "@/components/bridge/BridgeOverviewClient";

export default async function ConsoleOverviewPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const settings = await getSettings(user.id);
  const binance = await getBinanceAccountMeta(user.id);
  const forex = await getForexConnectionView(user.id);
  const pendingIntents = await listIntents(user.id, "pending", 50);
  const isAdmin = user.role === "admin";

  return (
    <BridgeOverviewClient
      settings={settings}
      hasBinance={Boolean(binance)}
      eaConnected={forex.connected}
      eaOnline={forex.online}
      pendingIntents={pendingIntents}
      isAdmin={isAdmin}
      adminStats={isAdmin ? await getAdminPlatformStats() : undefined}
      masterKill={isAdmin ? await isMasterKillOn() : undefined}
    />
  );
}
