"use client";

import { useMemo } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";
import { cn } from "@/lib/utils";

/** Animated testimonial columns inspired by 21st.dev @sshahaider/testimonials-columns-1 */
export function LandingTestimonials() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).testimonials;

  const columns = useMemo(() => {
    const chunk = Math.ceil(c.items.length / 3);
    return [0, 1, 2].map((columnIndex) =>
      c.items.slice(columnIndex * chunk, columnIndex * chunk + chunk),
    );
  }, [c.items]);

  return (
    <section
      data-testid="landing-testimonials"
      className="border-b border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
          <p className="mt-2 text-xs text-muted-foreground">{c.disclaimer}</p>
        </div>

        <div className="relative mt-12 hidden gap-4 overflow-hidden md:grid md:grid-cols-3">
          {columns.map((column, columnIndex) => (
            <div
              key={columnIndex}
              className={cn(
                "flex flex-col gap-4",
                columnIndex === 1 && "md:-mt-6",
              )}
            >
              {[...column, ...column].map((item, index) => (
                // The second copy exists only to balance the staggered column
                // — hide the clones from assistive tech.
                <figure
                  key={`${item.name}-${index}`}
                  aria-hidden={index >= column.length || undefined}
                  className="rounded-[var(--radius-lg)] border border-border bg-card p-5 elevation-1"
                >
                  <blockquote className="text-sm leading-relaxed text-foreground/90">
                    “{item.quote}”
                  </blockquote>
                  <figcaption className="mt-4 flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground">
                      {item.initials}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.role}</p>
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 md:hidden">
          {c.items.map((item) => (
            <figure
              key={item.name}
              className="rounded-[var(--radius-lg)] border border-border bg-card p-5 elevation-1"
            >
              <blockquote className="text-sm leading-relaxed text-foreground/90">
                “{item.quote}”
              </blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground">
                  {item.initials}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.role}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
