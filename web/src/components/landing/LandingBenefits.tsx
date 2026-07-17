"use client";

import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";

export function LandingBenefits() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).benefits;

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
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {c.items.map((item, index) => (
            <li
              key={item.title}
              className="rounded-2xl border border-border bg-card p-6"
            >
              <span className="mb-3 inline-flex size-8 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">
                {index + 1}
              </span>
              <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
