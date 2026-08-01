"use client";

import Link from "next/link";
import { ArrowUpRight, LineChart, Shield, Sparkles } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";

const ICONS = {
  chart: LineChart,
  approval: Shield,
  trial: Sparkles,
} as const;

/**
 * Capability strip — the former stat cards recast as non-numeric chips
 * (spec §3/§6: Stats&KPIs → capability chips). Hrefs are kept verbatim.
 */
export function LandingStats() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).stats;

  return (
    <section
      id="stats"
      data-testid="landing-stats"
      className="scroll-mt-20 border-b border-border bg-muted/20"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
        </div>

        <ul className="mt-10 flex flex-wrap items-stretch justify-center gap-3">
          {c.items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <li key={item.title} className="flex">
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:border-foreground/20 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <span className="font-medium">{item.title}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {item.note}
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground rtl:-rotate-90"
                  />
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mx-auto mt-8 max-w-3xl text-center text-xs text-muted-foreground">
          {c.disclaimer}
        </p>
      </div>
    </section>
  );
}
