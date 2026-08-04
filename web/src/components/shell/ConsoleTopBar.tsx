"use client";

import { CandlestickChart, PanelLeft, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { NotificationCenter } from "@/components/agent/NotificationCenter";
import { BalanceChip } from "@/components/shell/BalanceChip";
import { TopBarAccountStatus } from "@/components/shell/TopBarAccountStatus";
import { SidebarProfileMenu } from "@/components/agent/SidebarProfileMenu";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/** Fired at the workspace so the chart re-requests its bars in place. */
export const CHART_RELOAD_EVENT = "aichart:reload-chart";

/** Fired at the workspace to raise/lower the chart surface. */
export const CHART_TOGGLE_EVENT = "aichart:toggle-chart";

/**
 * Bare icons, no boxes. A row of outlined buttons reads as four competing
 * controls; the glyph alone with a hover wash is enough at this size.
 */
const ICON_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The console header, identical for traders and admins.
 *
 * Trader refresh lives on the chart (ChartChrome) — a top-bar refresh on the
 * home composer screen was the wrong control for a page with no chart focus.
 * Admins still refresh the page from here.
 */
export function ConsoleTopBar({
  displayName,
  onToggleSidebar,
  sidebarOpen,
  /** Admins reload the page; traders no longer refresh from the top bar. */
  refreshMode,
  showBalance = false,
  showChartToggle = false,
  showAccountStatus = false,
}: {
  displayName: string;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  refreshMode: "page" | "none";
  /** Traders see subscription credit; the admin console is not a metered account. */
  showBalance?: boolean;
  /** Hidden on the bare home composer (no chat) — chart summon is not the job there. */
  showChartToggle?: boolean;
  /** Mode + broker + MT equity — traders only. */
  showAccountStatus?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  const refresh = useCallback(() => {
    if (refreshMode !== "page") return;
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 600);
    router.refresh();
  }, [refreshMode, router]);

  return (
    <div
      data-testid="console-top-bar"
      className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-3"
    >
      <button
        type="button"
        data-testid="mobile-menu-trigger"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? t("shell.close") : t("shell.open_menu")}
        aria-expanded={sidebarOpen}
        aria-controls="mobile-navigation-drawer"
        className={cn(ICON_BUTTON, "lg:hidden")}
      >
        <PanelLeft className="h-5 w-5 rtl:-scale-x-100" />
      </button>

      <div className="ms-auto flex items-center gap-1">
        {showAccountStatus && <TopBarAccountStatus />}
        {showBalance && <BalanceChip />}
        {showChartToggle && (
          <button
            type="button"
            data-testid="topbar-chart-toggle"
            onClick={() => window.dispatchEvent(new CustomEvent(CHART_TOGGLE_EVENT))}
            aria-label={t("layout.show_chart")}
            title={t("layout.show_chart")}
            className={ICON_BUTTON}
          >
            <CandlestickChart className="h-5 w-5" />
          </button>
        )}
        {refreshMode === "page" && (
          <button
            type="button"
            data-testid="console-refresh"
            onClick={refresh}
            aria-label={t("shell.refresh")}
            title={t("shell.refresh")}
            className={ICON_BUTTON}
          >
            <RefreshCw
              className={cn("h-5 w-5", spinning && "animate-spin motion-reduce:animate-none")}
            />
          </button>
        )}
        <NotificationCenter />
        <SidebarProfileMenu variant="topbar" displayName={displayName} />
      </div>
    </div>
  );
}
