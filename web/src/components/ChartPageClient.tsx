"use client";

import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import { SmartChartWorkspace } from "@/components/SmartChartWorkspace";
import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export default function ChartPageClient({
  email,
  role,
  agentReady,
}: {
  email: string;
  role: "user" | "admin";
  agentReady: boolean;
}) {
  return (
    <AppConsoleShell role={role} displayName={nameFromEmail(email)} noPadding>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ChartErrorBoundary>
          <SmartChartWorkspace agentReady={agentReady} />
        </ChartErrorBoundary>
      </div>
    </AppConsoleShell>
  );
}
