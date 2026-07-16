"use client";

import Link from "next/link";
import { AiChartLogo } from "@/components/AiChartLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import { SmartChartWorkspace } from "@/components/SmartChartWorkspace";
import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";
import { useLocale } from "@/hooks/useLocale";

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Slim public header for guests: brand + sign-in / sign-up. */
function GuestChartHeader() {
  const { t, dir } = useLocale();

  return (
    <header
      dir={dir}
      className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/80 px-3 backdrop-blur-md sm:px-4"
    >
      <Link href="/" className="flex items-center gap-2">
        <AiChartLogo size={20} showName />
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {t("chart.smart_chart")}
        </span>
      </Link>
      <div className="flex items-center gap-2">
        <div className="hidden sm:block">
          <LanguageSwitcher />
        </div>
        <Link
          href="/login?next=/chart"
          className="inline-flex min-h-11 items-center rounded-md px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("chart.sign_in")}
        </Link>
        <Link
          href="/signup"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("chart.create_account")}
        </Link>
      </div>
    </header>
  );
}

export default function ChartPageClient({
  email,
  role,
  agentReady,
  guest = false,
  initialSymbol,
  layoutId,
  initialInterval,
  initialState,
}: {
  email: string | null;
  role: "user" | "admin";
  agentReady: boolean;
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
        <main className="min-h-0 flex-1 outline-none">
          <ChartErrorBoundary>
            <SmartChartWorkspace
              agentReady={agentReady}
              guest
              initialSymbol={initialSymbol}
            />
          </ChartErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <AppConsoleShell role={role} displayName={nameFromEmail(email ?? "")} noPadding>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ChartErrorBoundary>
          <SmartChartWorkspace
            agentReady={agentReady}
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
