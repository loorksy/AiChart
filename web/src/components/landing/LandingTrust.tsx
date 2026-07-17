"use client";

import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";

export function LandingTrust() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).trust;

  return (
    <section
      id="trust"
      data-testid="landing-trust"
      className="scroll-mt-20 border-b border-border bg-muted/30"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
        </div>
        <ul className="mx-auto mt-10 grid max-w-3xl gap-3">
          {c.items.map((item) => (
            <li
              key={item}
              className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground/90"
            >
              {item}
            </li>
          ))}
        </ul>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
          {c.riskNote}
        </p>
      </div>
    </section>
  );
}
