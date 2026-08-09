"use client";

import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";

export function LandingHistory() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).history;

  return (
    <section
      data-testid="landing-history"
      className="border-b border-border"
    >
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {c.title}
        </h2>
        <p className="mt-4 text-muted-foreground leading-relaxed">{c.body}</p>
        <p className="mt-4 text-sm text-muted-foreground">{c.disclaimer}</p>
      </div>
    </section>
  );
}
