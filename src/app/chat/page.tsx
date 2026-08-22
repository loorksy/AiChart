import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateChartLayout } from "@/lib/store";
import { SmartChartWorkspace } from "@/components/SmartChartWorkspace";
import { AdModal } from "@/components/ads/AdModal";
import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";
import { SubscribeClient } from "@/components/subscription/SubscribeClient";
import { isLLMConfiguredAsync } from "@/lib/llm";
import { initDb } from "@/lib/db";
import { getEntitlementForUser, loadTrialConfig } from "@/lib/subscription/entitlement";
import { getCurrentPlanPrice } from "@/lib/billing/planConfig";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  // An admin's console is the platform console. This route used to render the
  // trader bridge for them, which mixed an operator workspace into the admin's
  // landing page; the admin surfaces all live under ?tab= instead.
  if (user.role === "admin") {
    redirect("/console/platform?tab=overview");
  }

  await initDb();
  const entitlement = await getEntitlementForUser(user);
  const [planPrice, trialCfg] = await Promise.all([getCurrentPlanPrice(), loadTrialConfig()]);
  const planFacts = {
    priceCents: planPrice?.price_cents ?? null,
    trialLimit: trialCfg.trialLimit,
    trialDurationMinutes: Math.round(trialCfg.trialDurationMs / 60000),
  };

  if (entitlement.access === "blocked") {
    return (
      <SubscribeClient
        mode="blocked"
        trialRemaining={entitlement.trialRemaining}
        plan={planFacts}
      />
    );
  }

  // A valid trial gets the FULL workspace — every feature, bounded only by
  // the one-hour clock and the three-recommendation cap enforced server-side.

  const layout = await getOrCreateChartLayout(user.id);
  let initialState: import("@/components/SmartChartWorkspace").ChartLayoutState | null = null;
  try {
    initialState = layout.state_json ? JSON.parse(layout.state_json) : null;
  } catch {
    initialState = null;
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* One ad per session at most; the refusal modal always outranks it. */}
      <AdModal />
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
