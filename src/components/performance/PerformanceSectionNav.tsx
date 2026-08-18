"use client";

import { useState } from "react";
import { BarChart3, ListChecks } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "recommendations", labelKey: "rec.page.title", icon: ListChecks },
  { id: "statistics", labelKey: "stats.title", icon: BarChart3 },
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
      {/* The journal pill pointed at /journal, a route that does not exist —
          it 404'd for every operator who tapped it. The trading record lives
          in the recommendations section above. */}
    </nav>
  );
}
