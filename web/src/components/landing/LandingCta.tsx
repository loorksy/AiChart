"use client";

import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";

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
          <Link
            href={LANDING_ROUTES.signup}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            {c.primary}
          </Link>
          <Link
            href={LANDING_ROUTES.login}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            {c.secondary}
          </Link>
        </div>
      </div>
    </section>
  );
}
