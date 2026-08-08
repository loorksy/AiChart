"use client";

import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import { ProductPreview } from "@/components/landing/ProductPreview";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";
import { buttonVariants } from "@/components/squareui/button";
import { BRAND_NAME } from "@/lib/brand";

/** Brand-first hero: Lonora dominates the first viewport; one headline, one line, CTAs. */
export function LandingHero() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).hero;

  return (
    <section
      data-testid="landing-hero"
      className="relative border-b border-border bg-background"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-12 lg:py-20">
        <div className="max-w-xl">
          <h1 className="font-serif text-5xl font-semibold tracking-tight text-foreground sm:text-6xl lg:text-[4.25rem] lg:leading-[1.05]">
            {BRAND_NAME}
          </h1>
          <p className="mt-4 text-balance text-xl font-semibold tracking-tight text-foreground sm:text-2xl sm:leading-snug">
            {c.title}
          </p>
          <p className="mt-3 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground">
            {c.subtitle}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={LANDING_ROUTES.signup}
              className={buttonVariants({ size: "xl", className: "px-6" })}
            >
              {c.primaryCta}
            </Link>
            <Link
              href={LANDING_ROUTES.console}
              className={buttonVariants({
                variant: "outline",
                size: "xl",
                className: "px-6",
              })}
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
