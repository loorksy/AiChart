"use client";

import Link from "next/link";
import { LineChart, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";
import { ProductPreview } from "@/components/landing/ProductPreview";
import { SparklesBackground } from "@/components/landing/SparklesBackground";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";
import { buttonVariants } from "@/components/squareui/button";
import { Surface } from "@/components/foundation";

/** Hero with sparkles + moon-chat style quick prompts inspired by 21st.dev @ruixen.ui/ruixen-moon-chat */
export function LandingHero() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).hero;

  return (
    <section
      data-testid="landing-hero"
      className="relative overflow-hidden border-b border-border"
    >
      <SparklesBackground />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-12 lg:py-20">
        <div className="max-w-xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {c.eyebrow}
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl sm:leading-[1.12] lg:text-[3.1rem] lg:leading-[1.12]">
            {c.title}
          </h1>
          <p className="mt-4 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground sm:text-[1.05rem]">
            {c.subtitle}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {c.quickPrompts.map((prompt) => (
              <span
                key={prompt}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm"
              >
                <Sparkles className="size-3.5" />
                {prompt}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={LANDING_ROUTES.signup}
              className={buttonVariants({ size: "xl", className: "px-6" })}
            >
              {c.primaryCta}
            </Link>
            <Link
              href={LANDING_ROUTES.chart}
              className={buttonVariants({
                variant: "outline",
                size: "xl",
                className: "bg-background/80 px-6 backdrop-blur-sm",
              })}
            >
              {c.secondaryCta}
            </Link>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {c.highlights.map((item) => {
              const Icon =
                item.icon === "chart"
                  ? LineChart
                  : item.icon === "chat"
                    ? MessageSquare
                    : ShieldCheck;
              return (
                <Surface
                  key={item.label}
                  padding="none"
                  className="bg-card/70 px-3 py-3 backdrop-blur-sm"
                >
                  <Icon className="mb-2 size-4 text-foreground" strokeWidth={1.5} />
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </Surface>
              );
            })}
          </div>
        </div>

        <ProductPreview className="shadow-lg shadow-black/5 dark:shadow-black/30" />
      </div>
    </section>
  );
}
