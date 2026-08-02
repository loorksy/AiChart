"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelLeft, RefreshCw } from "lucide-react";
import { NotificationCenter } from "@/components/agent/NotificationCenter";
import { BalanceChip } from "@/components/shell/BalanceChip";
import { SidebarProfileMenu } from "@/components/agent/SidebarProfileMenu";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/** Fired at the workspace so the chart re-requests its bars in place. */
export const CHART_RELOAD_EVENT = "aichart:reload-chart";

/**
 * Bare icons, no boxes. A row of outlined buttons reads as four competing
 * controls; the glyph alone with a hover wash is enough at this size.
 */
const ICON_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The console header, identical for traders and admins.
 *
 * Account, alerts, navigation and refresh were previously scattered — the bell
 * in the sidebar, the account menu behind two taps at the bottom of a drawer,
 * no refresh at all — and the admin dashboard had grown a private header of its
 * own on top of that. One bar owns all four now, in one order, on both consoles.
 */
export function ConsoleTopBar({
  displayName,
  onToggleSidebar,
  sidebarOpen,
  /** Admins reload the page; traders reload the chart in place. */
  refreshMode,
  showBalance = false,
}: {
  displayName: string;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  refreshMode: "page" | "chart";
  /** Traders see their credit; the admin console is not a metered account. */
  showBalance?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  const refresh = useCallback(() => {
    setSpinning(true);
    // Long enough to read as a response even when the work finishes instantly.
    window.setTimeout(() => setSpinning(false), 600);
    if (refreshMode === "chart") {
      window.dispatchEvent(new CustomEvent(CHART_RELOAD_EVENT));
      return;
    }
    router.refresh();
  }, [refreshMode, router]);

  return (
    <div
      data-testid="console-top-bar"
      className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-3"
    >
      {/*
        The navigation toggle sits on the edge the navigation itself comes from
        — the start edge, mirrored automatically under dir="rtl" — so the button
        points at where the drawer will appear rather than across the bar from
        it. Everything else is grouped against the opposite edge, with the
        avatar in the outer corner.
      */}
      <button
        type="button"
        data-testid="mobile-menu-trigger"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? t("shell.close") : t("shell.open_menu")}
        aria-expanded={sidebarOpen}
        aria-controls="mobile-navigation-drawer"
        className={ICON_BUTTON}
      >
        <PanelLeft className="h-5 w-5 rtl:-scale-x-100" />
      </button>

      <div className="ms-auto flex items-center gap-1">
        {showBalance && <BalanceChip />}
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
        <NotificationCenter />
        <SidebarProfileMenu variant="topbar" displayName={displayName} />
      </div>
    </div>
  );
}
