import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getAdminPlatformStats,
  getSettings,
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
  const forex = await getForexConnectionView(user.id);
  const pendingIntents = await listIntents(user.id, "pending", 50);

  return (
    <BridgeOverviewClient
      settings={settings}
      eaConnected={forex.connected}
      eaOnline={forex.online}
      pendingIntents={pendingIntents}
      isAdmin
      adminStats={await getAdminPlatformStats()}
    />
  );
}
