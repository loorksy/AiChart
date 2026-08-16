"use client";

import { CandlestickChart, PanelLeft, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { NotificationCenter } from "@/components/agent/NotificationCenter";
import { BalanceChip } from "@/components/shell/BalanceChip";
import { SidebarProfileMenu } from "@/components/agent/SidebarProfileMenu";
import { MetalIconButton } from "@/components/ui/metal-icon-button";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/** Fired at the workspace so the chart re-requests its bars in place. */
export const CHART_RELOAD_EVENT = "aichart:reload-chart";

/** Fired at the workspace to raise/lower the chart surface. */
export const CHART_TOGGLE_EVENT = "aichart:toggle-chart";

/**
 * The console header, identical for traders and admins.
 *
 * On narrow viewports the middle cluster (mode, MT, credit, chart toggle)
 * scrolls horizontally so nothing is dropped or crushed. Sidebar toggle and
 * profile stay pinned off the scrollport.
 */
export function ConsoleTopBar({
  displayName,
  onToggleSidebar,
  sidebarOpen,
  /** Admins reload the page; traders re-request candles without a remount. */
  refreshMode,
  showBalance = false,
  showChartToggle = false,
  showAccountStatus = false,
}: {
  displayName: string;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  refreshMode: "page" | "chart" | "none";
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollEnd, setCanScrollEnd] = useState(false);

  const refresh = useCallback(() => {
    if (refreshMode === "none") return;
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 600);
    if (refreshMode === "page") {
      router.refresh();
      return;
    }
    window.dispatchEvent(new CustomEvent(CHART_RELOAD_EVENT));
  }, [refreshMode, router]);

  const updateScrollAffordance = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) {
      setCanScrollEnd(false);
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    // RTL: scrollLeft can be negative; use abs.
    const left = Math.abs(el.scrollLeft);
    setCanScrollEnd(max > 4 && left < max - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateScrollAffordance();
    el.addEventListener("scroll", updateScrollAffordance, { passive: true });
    const ro = new ResizeObserver(updateScrollAffordance);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollAffordance);
      ro.disconnect();
    };
  }, [updateScrollAffordance, showAccountStatus, showBalance, showChartToggle]);

  // Tabbing to an off-screen control scrolls it into view.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onFocusIn = (ev: FocusEvent) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      if (!el.contains(target)) return;
      target.scrollIntoView({
        inline: "nearest",
        block: "nearest",
        behavior: "smooth",
      });
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, []);

  return (
    <div
      data-testid="console-top-bar"
      className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-3"
    >
      <span className="lg:hidden">
        <MetalIconButton
          data-testid="mobile-menu-trigger"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? t("shell.close") : t("shell.open_menu")}
          aria-expanded={sidebarOpen}
          aria-controls="mobile-navigation-drawer"
        >
          <PanelLeft className="h-5 w-5 rtl:-scale-x-100" />
        </MetalIconButton>
      </span>

      <div className="relative ms-auto min-w-0 flex-1">
        <div
          ref={scrollerRef}
          data-testid="topbar-scroll"
          className={cn(
            "flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain",
            // Touch momentum; never steal vertical page scroll.
            "[touch-action:pan-x] [-webkit-overflow-scrolling:touch]",
            "scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "justify-end",
          )}
        >
          {showBalance && <BalanceChip />}
          {showChartToggle && (
            <MetalIconButton
              data-testid="topbar-chart-toggle"
              onClick={() => window.dispatchEvent(new CustomEvent(CHART_TOGGLE_EVENT))}
              aria-label={t("layout.show_chart")}
              title={t("layout.show_chart")}
            >
              <CandlestickChart className="h-5 w-5" />
            </MetalIconButton>
          )}
          {(refreshMode === "page" || refreshMode === "chart") && (
            <MetalIconButton
              data-testid={refreshMode === "chart" ? "chart-refresh" : "console-refresh"}
              onClick={refresh}
              aria-label={t("shell.refresh")}
              title={t("shell.refresh")}
            >
              <RefreshCw
                className={cn("h-5 w-5", spinning && "animate-spin motion-reduce:animate-none")}
              />
            </MetalIconButton>
          )}
          <NotificationCenter />
          <SidebarProfileMenu variant="topbar" displayName={displayName} />
        </div>
        {canScrollEnd && (
          <div
            data-testid="topbar-scroll-fade"
            aria-hidden
            className="pointer-events-none absolute inset-y-0 end-0 w-8 bg-gradient-to-l from-background to-transparent rtl:bg-gradient-to-r"
          />
        )}
      </div>
    </div>
  );
}
