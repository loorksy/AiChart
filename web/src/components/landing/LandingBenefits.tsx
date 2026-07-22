"use client";

import Link from "next/link";
import { ArrowUpRight, BarChart3, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";
import { Card, CardContent } from "@/components/ui/card";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";

/** Bento features grid inspired by 21st.dev @meschacirung/features-8 */
export function LandingBenefits() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).benefits;
  const [first, second, third] = c.items;

  return (
    <section
      id="features"
      data-testid="landing-benefits"
      className="scroll-mt-20 border-b border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
        </div>

        <div className="relative mt-12">
          <div className="relative z-10 grid grid-cols-6 gap-3">
            <Card className="relative col-span-full overflow-hidden lg:col-span-2">
              <CardContent className="relative m-auto flex size-fit flex-col items-center px-6 pb-6 pt-8 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-border bg-muted/40">
                  <Sparkles className="size-5 text-foreground" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{first.title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {first.body}
                </p>
              </CardContent>
            </Card>

            <Card className="relative col-span-full overflow-hidden sm:col-span-3 lg:col-span-2">
              <CardContent className="flex h-full flex-col justify-between pt-6">
                <div className="mx-auto flex aspect-square size-24 items-center justify-center rounded-full border border-border before:absolute before:-inset-2 before:rounded-full before:border before:border-border/50">
                  <BarChart3 className="size-8 text-foreground" strokeWidth={1.25} />
                </div>
                <div className="relative z-10 mt-8 space-y-2 text-center">
                  <h3 className="text-lg font-semibold text-foreground">{second.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{second.body}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="relative col-span-full overflow-hidden sm:col-span-3 lg:col-span-2">
              <CardContent className="flex h-full flex-col justify-between pt-6">
                <div className="mx-auto flex aspect-square size-24 items-center justify-center rounded-full border border-border">
                  <ShieldCheck className="size-8 text-foreground" strokeWidth={1.25} />
                </div>
                <div className="relative z-10 mt-8 space-y-2 text-center">
                  <h3 className="text-lg font-semibold text-foreground">{third.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{third.body}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="relative col-span-full overflow-hidden lg:col-span-3">
              <CardContent className="grid gap-6 pt-6 sm:grid-cols-2">
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {c.workspaceLabel}
                  </p>
                  <ul className="space-y-2 text-sm text-foreground/90">
                    {c.workspacePoints.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/70" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium text-foreground">{c.panelTitle}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{c.panelBody}</p>
                  <Link
                    href={LANDING_ROUTES.chart}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
                  >
                    {c.panelCta}
                    <ArrowUpRight className="size-4" />
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="relative col-span-full overflow-hidden lg:col-span-3">
              <CardContent className="grid h-full gap-6 pt-6 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {c.executionLabel}
                  </p>
                  <h3 className="text-lg font-semibold text-foreground">{c.executionTitle}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{c.executionBody}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background px-5 py-4 text-center">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {c.executionBadge}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">BUY · SELL · WAIT</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
