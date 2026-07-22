"use client";

import Link from "next/link";
import { ArrowUpRight, LineChart, Shield, Sparkles } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";
import { Card, CardContent } from "@/components/ui/card";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";

const ICONS = {
  chart: LineChart,
  approval: Shield,
  trial: Sparkles,
} as const;

/** Stats cards inspired by 21st.dev @ephraimduncan/stats-cards-with-links */
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

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {c.items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <Card key={item.title} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="border-b border-border px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {item.eyebrow}
                        </p>
                        <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                          {item.value}
                        </p>
                        <p className="mt-1 text-sm font-medium text-foreground">{item.title}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/40 p-2">
                        <Icon className="size-4 text-foreground" strokeWidth={1.5} />
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                  <div className="flex items-center justify-between px-5 py-3">
                    <span className="text-xs text-muted-foreground">{item.note}</span>
                    <Link
                      href={item.href}
                      className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
                    >
                      {item.linkLabel}
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-xs text-muted-foreground">
          {c.disclaimer}
        </p>
      </div>
    </section>
  );
}
