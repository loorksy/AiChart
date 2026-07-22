"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { Card, CardContent } from "@/components/ui/card";
import { getLandingCopy } from "@/components/landing/landingCopy";

/** Pricing section inspired by 21st.dev pricing blocks */
export function LandingPricing() {
  const { locale, dir } = useLocale();
  const isAr = locale === "ar";
  const c = getLandingCopy(locale).pricing;

  return (
    <section
      id="pricing"
      dir={dir}
      data-testid="landing-pricing"
      className="border-b border-border px-4 py-16 sm:px-6 sm:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {c.eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {isAr ? AICHART_PLAN.titleAr : AICHART_PLAN.titleEn}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            {c.subtitle}
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-6 lg:grid-cols-[1fr_1.05fr]">
          <Card className="border-border/80 bg-muted/20 shadow-none">
            <CardContent className="p-6 sm:p-8">
              <p className="text-sm font-medium text-foreground">{c.trialTitle}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {c.trialBody}
              </p>
              <ul className="mt-5 space-y-2 text-sm text-foreground/90">
                {c.trialPoints.map((point) => (
                  <li key={point} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-foreground" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-foreground/15 shadow-lg shadow-black/5 dark:shadow-black/20">
            <div className="absolute inset-x-0 top-0 h-1 bg-foreground" />
            <CardContent className="p-6 text-start sm:p-8">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-semibold text-foreground">
                  ${AICHART_PLAN.promotionalPriceUsd}
                </span>
                <span className="text-base text-muted-foreground line-through">
                  ${AICHART_PLAN.regularPriceUsd}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{c.priceNote}</p>
              <ul className="mt-5 space-y-2 text-sm text-foreground">
                {c.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-foreground" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <a
                href={AICHART_PLAN.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="landing-subscribe-cta"
                className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                {c.cta}
              </a>
              <p className="mt-3 text-xs text-muted-foreground">{c.activationNote}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
