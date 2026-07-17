"use client";

import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";

export function LandingHowItWorks() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).how;

  return (
    <section
      id="how"
      data-testid="landing-how"
      className="scroll-mt-20 border-b border-border bg-muted/30"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
        </div>
        <ol className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-3">
          {c.steps.map((step) => (
            <li key={step.n} className="text-center sm:text-start">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background sm:mx-0">
                {step.n}
              </div>
              <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
