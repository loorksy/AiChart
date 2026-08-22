"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
// Existing contact destination — the same manual-activation channel the
// platform already links to.
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { Surface } from "@/components/foundation";
import { buttonVariants } from "@/components/squareui/button";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";
import { cn } from "@/lib/utils";

const FEATURE_KEYS = [
  "telegramBot",
  "trackedRecommendations",
  "scalpEngine",
  "voice",
  "prioritySupport",
] as const;

interface PlanFacts {
  price_cents: number | null;
  credits_per_cycle: number | null;
  title_ar: string;
  title_en: string;
}

/** Single-plan pricing summary — one card, every feature, plus the trial note. */
export function LandingPricing() {
  const { locale, dir } = useLocale();
  const isAr = locale === "ar";
  const c = getLandingCopy(locale).pricing;
  // Billing v3: the price is DATA — the summary reads the same plan row the
  // billing gate enforces, so the landing can never drift from reality.
  const [plan, setPlan] = useState<PlanFacts | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/billing/plan")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PlanFacts | null) => {
        if (alive && d) setPlan(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
            {c.title}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            {c.subtitle}
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-md gap-4">
          {(() => {
            const highlight = true;
            const enabled = [...FEATURE_KEYS];
            return (
              <Surface
                as="section"
                padding="md"
                elevation={highlight ? 2 : 1}
                className={cn(
                  "relative flex flex-col",
                  // Brand-premium gold is reserved for exactly this moment
                  // (spec §1 --accent-gold policy).
                  highlight && "border-accent-gold/70",
                )}
              >
                {highlight && (
                  <span className="absolute -top-3 end-4 rounded-full bg-accent-gold px-3 py-0.5 text-xs font-semibold text-black">
                    {c.highlightBadge}
                  </span>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-bold text-foreground">
                    {isAr ? AICHART_PLAN.titleAr : AICHART_PLAN.titleEn}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {isAr ? AICHART_PLAN.titleEn : AICHART_PLAN.titleAr}
                  </span>
                </div>
                {plan?.price_cents != null ? (
                  <p className="mt-3 flex items-baseline gap-1" dir="ltr">
                    <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
                      ${plan.price_cents / 100}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.perMonth}
                    </span>
                  </p>
                ) : null}
                {plan?.credits_per_cycle != null && plan.credits_per_cycle > 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {c.creditsPrefix}{" "}
                    <span className="font-semibold tabular-nums text-foreground" dir="ltr">
                      {plan.credits_per_cycle}
                    </span>
                  </p>
                ) : null}
                <ul className="mt-4 flex-1 space-y-1.5 text-xs text-foreground/90">
                  <li className="flex items-center gap-1.5">
                    <Check
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    {c.modelsAll}
                  </li>
                  {enabled.map((key) => (
                    <li key={key} className="flex items-center gap-1.5">
                      <Check
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      {c.featureLabels[key]}
                    </li>
                  ))}
                </ul>
              </Surface>
            );
          })()}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
            <LiquidMetalButton
              href={LANDING_ROUTES.pricing}
              label={c.cta}
              data-testid="landing-subscribe-cta"
            />
            <a
              href={AICHART_PLAN.telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({
                variant: "outline",
                size: "xl",
                className: "w-full px-6 sm:w-auto",
              })}
            >
              {c.contactCta}
            </a>
          </div>
          <p className="text-xs text-muted-foreground">{c.ctaNote}</p>
        </div>
      </div>
    </section>
  );
}
