"use client";

import Link from "next/link";
import { Globe } from "lucide-react";
import { AiChartLogo } from "@/components/AiChartLogo";
import { LANDING } from "@/components/landing/landingContent";
import { useLocale } from "@/components/LocaleProvider";

export function LandingNav() {
  const { locale, setLocale } = useLocale();

  const isRtl = locale === "ar";
  const loginText = isRtl ? "تسجيل الدخول" : "Sign In";
  const startFreeText = isRtl ? "ابدأ مجاناً" : "Start Free";

  const toggleLocale = () => {
    setLocale(isRtl ? "en" : "ar");
  };

  return (
    <header className="glass-panel sticky top-0 z-50 border-b border-border/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
        <Link href="/" className="group flex items-center gap-2">
          <AiChartLogo
            size={36}
            showName
            nameClassName="text-lg font-bold tracking-tight text-foreground group-hover:text-primary transition-colors"
          />
        </Link>

        <nav className="hidden items-center gap-6 text-xs font-mono uppercase tracking-wider text-muted-foreground md:flex">
          {LANDING.nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="relative py-1 transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all hover:after:w-full"
            >
              {isRtl ? item.labelAr : item.labelEn}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleLocale}
            className="flex size-11 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={isRtl ? "Switch to English" : "التبديل إلى العربية"}
            title={isRtl ? "Switch to English" : "تغيير إلى العربية"}
          >
            <Globe className="h-4 w-4" />
          </button>

          <Link
            href="/login"
            className="hidden min-h-11 items-center rounded-xl border border-border bg-card/60 px-4 text-xs font-medium text-foreground/80 transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:inline-flex"
          >
            {loginText}
          </Link>

          <Link
            href="/signup"
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground transition-all duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {startFreeText}
          </Link>
        </div>
      </div>
    </header>
  );
}
