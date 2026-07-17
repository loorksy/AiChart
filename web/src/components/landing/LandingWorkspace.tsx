"use client";

import { useLocale } from "@/components/LocaleProvider";
import { ProductPreview } from "@/components/landing/ProductPreview";
import { getLandingCopy } from "@/components/landing/landingCopy";

export function LandingWorkspace() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).workspace;

  return (
    <section
      data-testid="landing-workspace"
      className="border-b border-border"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
          <ul className="mt-8 space-y-3">
            {c.points.map((point) => (
              <li
                key={point}
                className="flex gap-3 text-sm leading-relaxed text-foreground/90"
              >
                <span
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground"
                  aria-hidden
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <ProductPreview />
      </div>
    </section>
  );
}
