"use client";

import Image from "next/image";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";

const PARTNER_LOGOS = [
  { name: "MetaTrader 5", src: "/partners/mt5.svg" },
  { name: "OpenAI ChatGPT", src: "/partners/openai.svg" },
  { name: "Claude", src: "/partners/claude.svg" },
  { name: "TradingView", src: "/partners/tradingview.svg" },
] as const;

/** Logo cloud inspired by 21st.dev @sshahaider/logo-cloud-4 */
export function LandingPartners() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).partners;

  return (
    <section
      data-testid="landing-partners"
      className="border-b border-border bg-muted/20 py-16 sm:py-20"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-center text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {c.eyebrow}
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {PARTNER_LOGOS.map((logo) => (
            <div
              key={logo.name}
              className="group relative flex min-h-16 items-center justify-center rounded-[var(--radius-lg)] border border-border bg-card px-4 py-5 elevation-1 transition-colors hover:border-foreground/20"
            >
              <span className="pointer-events-none absolute inset-0 rounded-[var(--radius-lg)] bg-gradient-to-b from-foreground/[0.03] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <Image
                src={logo.src}
                alt={logo.name}
                width={120}
                height={32}
                className="relative h-7 w-auto max-w-full text-foreground opacity-80 transition-opacity group-hover:opacity-100 dark:invert-[0.92]"
              />
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted-foreground">
          {c.note}
        </p>
      </div>
    </section>
  );
}
