import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getAdminPlatformStats,
  getBinanceAccountMeta,
  getSettings,
  isMasterKillOn,
  listIntents,
} from "@/lib/store";
import { getForexConnectionView } from "@/lib/forexConnection";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { BridgeOverviewClient } from "@/components/bridge/BridgeOverviewClient";
import { UserHomeClient } from "@/components/user/UserHomeClient";

export default async function ConsoleOverviewPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (user.role !== "admin") {
    const mcpUrl =
      process.env.MCP_PUBLIC_URL?.trim() || "https://aichart.lork.cloud/mcp";
    return (
      <UserHomeClient
        user={user}
        mcpUrl={mcpUrl}
        canDownloadEa={hasPlatformAccess(user)}
      />
    );
  }

  const settings = await getSettings(user.id);
  const binance = await getBinanceAccountMeta(user.id);
  const forex = await getForexConnectionView(user.id);
  const pendingIntents = await listIntents(user.id, "pending", 50);

  return (
    <BridgeOverviewClient
      settings={settings}
      hasBinance={Boolean(binance)}
      eaConnected={forex.connected}
      eaOnline={forex.online}
      pendingIntents={pendingIntents}
      isAdmin
      adminStats={await getAdminPlatformStats()}
      masterKill={await isMasterKillOn()}
    />
  );
}
