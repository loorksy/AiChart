"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { VercelV0Chat } from "@/components/ui/v0-ai-chat";
import { useLocale } from "@/components/LocaleProvider";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export function LandingHero() {
  const router = useRouter();
  const { locale } = useLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleSend(text: string) {
    sessionStorage.setItem("aichart_pending_prompt", text);
    router.push("/signup");
  }

  const isRtl = locale === "ar";

  const tagline = isRtl
    ? "مساعد تداول ذكي · MetaTrader 5"
    : "AI Trading Assistant · MetaTrader 5";

  const titlePre = isRtl ? "تداول بذكاء مع " : "Trade Smartly with ";
  const titleGlow = "AiChart";
  const titlePost = isRtl ? "" : "";

  const subtitle = isRtl
    ? "حلّل السوق بالمحادثة والشارت، ثم نفّذ عبر MetaTrader بعد موافقتك وبحماية تقنية. استعرض الشارت الآن مجاناً بلا تسجيل."
    : "Analyze the market through chat and chart, then execute on MetaTrader 5 after approval with technical safeguards. Browse the live chart free, no sign-up.";

  const ctaPrimary = isRtl ? "ابدأ مجاناً" : "Start Free";
  const ctaSecondary = isRtl ? "تسجيل الدخول" : "Sign In";
  const ctaChart = isRtl ? "استعرض الشارت" : "Open the chart";
  const chatTitle = isRtl ? "ماذا ستتداول اليوم؟" : "What are we trading today?";
  const chatSubtitle = isRtl
    ? "جرّب سؤالاً — سجّل لحفظ محادثاتك وربط حساب التداول."
    : "Try a prompt — register to save conversations and connect your trading account.";

  return (
    <section className="relative mx-auto max-w-6xl overflow-hidden px-4 py-20 sm:px-6 sm:py-28">
      <div className="absolute inset-x-0 top-0 -z-10 flex justify-center">
        <div className="h-[350px] w-[600px] rounded-full bg-primary/10 blur-[100px]" />
      </div>

      <div className="grid items-center gap-12 lg:grid-cols-12">
        <motion.div
          initial={{ opacity: 0, x: isRtl ? 40 : -40 }}
          animate={mounted ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="space-y-6 text-center ltr:lg:text-left rtl:lg:text-right lg:col-span-7"
        >
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3.5 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {tagline}
          </div>

          <h1 className="text-4xl font-extrabold leading-[1.15] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {titlePre}
            <span className="bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">
              {titleGlow}
            </span>
            {titlePost}
          </h1>

          <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base lg:mx-0">
            {subtitle}
          </p>

          <div className="flex flex-wrap justify-center gap-3.5 ltr:lg:justify-start rtl:lg:justify-end">
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground shadow-[var(--glow-brand)] transition-all duration-200 hover:brightness-110"
            >
              {ctaPrimary}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-border bg-card/50 px-5 py-3 text-xs font-semibold text-foreground/90 transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
            >
              {ctaSecondary}
            </Link>
            <Link
              href="/chart"
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-5 py-3 text-xs font-semibold text-primary transition-all duration-200 hover:bg-primary/20"
            >
              {ctaChart}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="glass-card lg:col-span-5 p-2 transition-all duration-300 hover:border-primary/35"
        >
          <VercelV0Chat
            title={chatTitle}
            subtitle={chatSubtitle}
            onSend={handleSend}
          />
        </motion.div>
      </div>
    </section>
  );
}
