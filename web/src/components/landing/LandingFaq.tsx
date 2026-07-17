"use client";

import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";

export function LandingFaq() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).faq;

  return (
    <section
      id="faq"
      data-testid="landing-faq"
      className="scroll-mt-20 border-b border-border bg-muted/30"
    >
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {c.title}
        </h2>
        <div className="mt-10 space-y-2">
          {c.items.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-border bg-card px-4 py-1 open:pb-3"
            >
              <summary className="cursor-pointer list-none py-3 text-sm font-medium text-foreground outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-3">
                  {item.q}
                  <span
                    aria-hidden
                    className="text-muted-foreground transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </span>
              </summary>
              <p className="pb-1 text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
