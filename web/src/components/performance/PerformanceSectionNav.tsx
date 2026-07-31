"use client";

import { BarChart3, ListChecks, TrendingUp } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

const SECTIONS = [
  { id: "recommendations", labelKey: "rec.page.title", icon: ListChecks },
  { id: "trades", labelKey: "trades.title", icon: TrendingUp },
  { id: "statistics", labelKey: "stats.title", icon: BarChart3 },
] as const;

/** Sticky in-page jump pills — one page, three sections, zero route hops. */
export function PerformanceSectionNav() {
  const { t, dir } = useLocale();
  return (
    <nav
      dir={dir}
      className="sticky top-2 z-10 -mx-1 flex gap-1.5 overflow-x-auto rounded-xl border border-border/60 bg-background/85 p-1.5 backdrop-blur"
    >
      {SECTIONS.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() =>
            document
              .getElementById(id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
          {t(labelKey)}
        </button>
      ))}
    </nav>
  );
}
