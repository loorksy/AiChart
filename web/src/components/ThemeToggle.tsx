"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/**
 * Canonical quick theme toggle for sidebar / mobile drawer.
 * Cycles dark ↔ light. Settings page still exposes Dark / Light / System.
 */
export function ThemeToggle({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  const { resolved, setTheme } = useTheme();
  const { t } = useLocale();
  const isDark = resolved === "dark";
  const label = isDark ? t("shell.theme_to_light") : t("shell.theme_to_dark");

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-transparent px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
        collapsed && "justify-center px-0",
        className,
      )}
      aria-label={label}
      title={label}
    >
      {isDark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
