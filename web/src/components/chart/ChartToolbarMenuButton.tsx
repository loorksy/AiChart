"use client";

import { Menu } from "lucide-react";
import { useShellMenu } from "@/components/shell/ShellMenuContext";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/**
 * Locale-aware menu control pinned inside the chart top toolbar.
 * LTR → physical left (inline-start). RTL → physical right (inline-start).
 * Stays fixed while TradingView header controls scroll beneath the reserved pad.
 */
export function ChartToolbarMenuButton({ className }: { className?: string }) {
  const menu = useShellMenu();
  const { t } = useLocale();
  if (!menu) return null;

  return (
    <div
      data-testid="chart-toolbar-menu-layer"
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-30 h-11 lg:hidden",
        className,
      )}
    >
      <div
        data-testid="chart-toolbar-menu-slot"
        className="pointer-events-auto absolute inset-y-0 start-0 flex w-12 items-center justify-center bg-background"
      >
        <button
          type="button"
          data-testid="mobile-menu-trigger"
          onClick={() => menu.openMobileMenu()}
          className="flex size-9 items-center justify-center rounded-lg border border-border bg-background text-foreground shadow-sm"
          aria-label={t("shell.open_menu")}
          aria-expanded={menu.mobileOpen}
          aria-controls="mobile-navigation-drawer"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
