"use client";

import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";
import { buttonVariants } from "@/components/squareui/button";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";

export function LandingCta() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).cta;

  return (
    <section data-testid="landing-cta" className="border-b border-border">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {c.title}
        </h2>
        <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <LiquidMetalButton href={LANDING_ROUTES.signup} label={c.primary} />
          <Link
            href={LANDING_ROUTES.login}
            className={buttonVariants({
              variant: "outline",
              size: "xl",
              className: "w-full px-6 sm:w-auto",
            })}
          >
            {c.secondary}
          </Link>
        </div>
      </div>
    </section>
  );
}
