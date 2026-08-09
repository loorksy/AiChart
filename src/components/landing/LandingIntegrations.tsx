"use client";

import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";

export function LandingIntegrations() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).integrations;

  return (
    <section
      data-testid="landing-integrations"
      className="border-b border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
        </div>
        <ul className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
          {c.items.map((item) => (
            <li
              key={item.name}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span className="text-sm font-medium text-foreground">{item.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.availability}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
