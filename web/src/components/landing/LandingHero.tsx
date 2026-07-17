"use client";

import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import { ProductPreview } from "@/components/landing/ProductPreview";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";

export function LandingHero() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).hero;

  return (
    <section
      data-testid="landing-hero"
      className="relative border-b border-border"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-12 lg:py-20">
        <div className="max-w-xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {c.eyebrow}
          </p>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-[2.65rem] lg:leading-[1.15]">
            {c.title}
          </h1>
          <p className="mt-4 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground sm:text-[1.05rem]">
            {c.subtitle}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={LANDING_ROUTES.signup}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {c.primaryCta}
            </Link>
            <Link
              href={LANDING_ROUTES.chart}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {c.secondaryCta}
            </Link>
          </div>
        </div>
        <ProductPreview />
      </div>
    </section>
  );
}
