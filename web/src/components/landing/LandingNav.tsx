"use client";

import Link from "next/link";
import { Sparkles, Globe } from "lucide-react";
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
    <header className="sticky top-0 z-50 border-b border-white/5 bg-black/40 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
        
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-[0_0_15px_rgba(124,58,237,0.3)] group-hover:shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-all duration-300">
            <Sparkles className="h-4.5 w-4.5 animate-pulse" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white transition-all duration-300">
            Ai<span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">Chart</span>
          </span>
        </Link>

        {/* Navigation Items */}
        <nav className="hidden items-center gap-6 text-xs font-mono uppercase tracking-wider text-white/50 md:flex">
          {LANDING.nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-white relative py-1 after:absolute after:bottom-0 after:left-0 after:h-[1px] after:w-0 after:bg-violet-500 after:transition-all hover:after:w-full"
            >
              {isRtl ? item.labelAr : item.labelEn}
            </a>
          ))}
        </nav>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          
          {/* Language Toggle Icon Button */}
          <button
            type="button"
            onClick={toggleLocale}
            className="flex size-11 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-white/70 transition-all hover:border-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            aria-label={isRtl ? "Switch to English" : "التبديل إلى العربية"}
            title={isRtl ? "Switch to English" : "تغيير إلى العربية"}
          >
            <Globe className="h-4 w-4" />
          </button>

          {/* Login Button */}
          <Link
            href="/login"
            className="hidden min-h-11 items-center rounded-xl border border-white/5 bg-white/5 px-4 text-xs font-medium text-white/80 transition-all duration-200 hover:border-white/10 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:inline-flex"
          >
            {loginText}
          </Link>

          {/* Call to Action Button */}
          <Link
            href="/signup"
            className="inline-flex min-h-11 items-center rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-xs font-medium text-white shadow-[0_0_15px_rgba(99,102,241,0.2)] transition-all duration-200 hover:brightness-110 hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            {startFreeText}
          </Link>
        </div>

      </div>
    </header>
  );
}
