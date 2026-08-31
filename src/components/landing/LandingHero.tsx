"use client";

import { useEffect } from "react";
import { useLocale } from "@/hooks/useLocale";
import { LandingComposer } from "@/components/landing/LandingComposer";

/** One-viewport hero: two-line headline + glass composer + feature pills. */
export function LandingHero() {
  const { t, dir } = useLocale();

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  return (
    <section
      data-testid="landing-hero"
      dir={dir}
      className="landing-hero flex h-full min-h-0 flex-col items-center overflow-hidden px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(4.25rem,10vh)] sm:px-8"
    >
      <h1 className="max-w-xl text-center text-[2rem] font-bold leading-[1.12] tracking-tight text-white sm:max-w-2xl sm:text-5xl lg:text-6xl">
        <span className="block">{t("landing.hero.line1")}</span>
        <span className="block">{t("landing.hero.line2")}</span>
      </h1>

      <div className="mt-8 flex w-full flex-1 flex-col items-center justify-start sm:mt-10">
        <LandingComposer />
      </div>
    </section>
  );
}
