"use client";

import Link from "next/link";
import { LonoraLogo } from "@/components/LonoraLogo";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import { SmartChartWorkspace } from "@/components/SmartChartWorkspace";
import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Slim public header for guests: brand + sign-in / sign-up. */
function GuestChartHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-card/80 px-3 backdrop-blur-md sm:px-4">
      <Link href="/" className="flex items-center gap-2">
        <LonoraLogo size={20} showName />
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          الشارت الذكي
        </span>
      </Link>
      <div className="flex items-center gap-2">
        <Link
          href="/login?next=/chart"
          className="rounded-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          تسجيل الدخول
        </Link>
        <Link
          href="/signup"
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          إنشاء حساب
        </Link>
      </div>
    </header>
  );
}

export default function ChartPageClient({
  email,
  role,
  agentReady,
  smartAgentEnabled = false,
  guest = false,
  initialSymbol,
  layoutId,
  initialInterval,
  initialState,
}: {
  email: string | null;
  role: "user" | "admin";
  agentReady: boolean;
  smartAgentEnabled?: boolean;
  guest?: boolean;
  initialSymbol?: string;
  layoutId?: string;
  initialInterval?: string;
  initialState?: import("@/components/SmartChartWorkspace").ChartLayoutState | null;
}) {
  if (guest) {
    return (
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
        <GuestChartHeader />
        <div className="min-h-0 flex-1">
          <ChartErrorBoundary>
            <SmartChartWorkspace
              agentReady={agentReady}
              guest
              initialSymbol={initialSymbol}
            />
          </ChartErrorBoundary>
        </div>
      </div>
    );
  }

  return (
    <AppConsoleShell role={role} displayName={nameFromEmail(email ?? "")} noPadding>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ChartErrorBoundary>
          <SmartChartWorkspace
            agentReady={agentReady}
            smartAgentEnabled={smartAgentEnabled}
            initialSymbol={initialSymbol}
            layoutId={layoutId}
            initialInterval={initialInterval}
            initialState={initialState}
          />
        </ChartErrorBoundary>
      </div>
    </AppConsoleShell>
  );
}
