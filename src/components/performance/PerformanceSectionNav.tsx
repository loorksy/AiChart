"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, BookOpen, FlaskConical, ListChecks, TrendingUp } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "recommendations", labelKey: "rec.page.title", icon: ListChecks },
  { id: "trades", labelKey: "trades.title", icon: TrendingUp },
  { id: "statistics", labelKey: "stats.title", icon: BarChart3 },
  { id: "backtests", labelKey: "bt.title", icon: FlaskConical },
] as const;

/** Sticky in-page jump pills — one page, three sections, zero route hops. */
export function PerformanceSectionNav() {
  const { t, dir } = useLocale();
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  return (
    <nav
      dir={dir}
      className="sticky top-2 z-raised -mx-1 flex gap-1.5 overflow-x-auto rounded-full border border-border/60 bg-background/85 p-1.5 backdrop-blur"
    >
      {SECTIONS.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? "true" : undefined}
          onClick={() => {
            setActive(id);
            document.getElementById(id)?.scrollIntoView({
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
              block: "start",
            });
          }}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors focus-ring sm:min-h-9",
            active === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {t(labelKey)}
        </button>
      ))}
      {/* The journal lives on its own route — appended here so the trading
          record is one tap away from the performance view. */}
      <Link
        href="/journal"
        className="ms-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring sm:min-h-9"
      >
        <BookOpen className="h-3.5 w-3.5" aria-hidden />
        {t("journal.title")}
      </Link>
    </nav>
  );
}
