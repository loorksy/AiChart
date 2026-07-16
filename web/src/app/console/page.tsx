import { getCurrentUser } from "@/lib/auth";
import { getAdminPlatformStats, getOrCreateChartLayout, getSettings, listIntents } from "@/lib/store";
import { getForexConnectionView } from "@/lib/forexConnection";
import { BridgeOverviewClient } from "@/components/bridge/BridgeOverviewClient";
import { SmartChartWorkspace } from "@/components/SmartChartWorkspace";
import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";
import { isLLMConfiguredAsync } from "@/lib/llm";
import { initDb } from "@/lib/db";

export default async function ConsoleOverviewPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (user.role !== "admin") {
    await initDb();
    const layout = await getOrCreateChartLayout(user.id);
    let initialState: import("@/components/SmartChartWorkspace").ChartLayoutState | null = null;
    try {
      initialState = layout.state_json ? JSON.parse(layout.state_json) : null;
    } catch {
      initialState = null;
    }
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ChartErrorBoundary>
          <SmartChartWorkspace
            agentReady={await isLLMConfiguredAsync()}
            initialSymbol={layout.symbol}
            layoutId={layout.id}
            initialInterval={layout.interval}
            initialState={initialState}
          />
        </ChartErrorBoundary>
      </div>
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
