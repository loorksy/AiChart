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
    ? "منصة تداول ذكية — Claude MCP · MetaTrader 5"
    : "AI-Powered Trading Assistant — Claude MCP · MetaTrader 5";

  const titlePre = isRtl ? "تداول بذكاء عبر " : "Trade Smartly with ";
  const titleGlow = "Claude MCP";
  const titlePost = isRtl ? "" : "";

  const subtitle = isRtl
    ? "اربط Claude Connectors بحسابك، راقب السوق، ونفّذ الصفقات عبر MetaTrader — مع Risk Guard. استعرض الشارت الآن مجاناً بلا تسجيل."
    : "Connect Claude Connectors, monitor markets, and execute trades on MetaTrader 5 — backed by Risk Guard. Browse the live chart free, no sign-up.";

  const ctaPrimary = isRtl ? "ابدأ مجاناً" : "Start Free";
  const ctaSecondary = isRtl ? "تسجيل الدخول" : "Sign In";
  const ctaChart = isRtl ? "استعرض الشارت" : "Open the chart";
  const chatTitle = isRtl ? "ماذا ستتداول اليوم؟" : "What are we trading today?";
  const chatSubtitle = isRtl
    ? "جرب سؤالاً — سجّل لربط Claude MCP والتداول الحقيقي."
    : "Try a prompt — register to link Claude MCP and begin real trading.";

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 overflow-hidden">
      
      {/* Top background radial lighting */}
      <div className="absolute inset-x-0 top-0 -z-10 flex justify-center">
        <div className="h-[350px] w-[600px] rounded-full bg-violet-600/10 blur-[100px]" />
      </div>

      <div className="grid items-center gap-12 lg:grid-cols-12">
        
        {/* Left/Right Text Content (7 columns on desktop) */}
        <motion.div
          initial={{ opacity: 0, x: isRtl ? 40 : -40 }}
          animate={mounted ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="lg:col-span-7 space-y-6 text-center ltr:lg:text-left rtl:lg:text-right"
        >
          {/* Glowing Badge */}
          <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/5 px-3.5 py-1 text-xs font-semibold text-violet-400 tracking-wide uppercase">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
            </span>
            {tagline}
          </div>

          {/* Headline */}
          <h1 className="text-4xl font-extrabold leading-[1.15] sm:text-5xl lg:text-6xl text-white tracking-tight">
            {titlePre}
            <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-violet-500 bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(124,58,237,0.15)]">
              {titleGlow}
            </span>
            {titlePost}
          </h1>

          {/* Subtitle */}
          <p className="text-sm text-white/50 sm:text-base leading-relaxed max-w-xl mx-auto lg:mx-0">
            {subtitle}
          </p>

          {/* Buttons */}
          <div className="flex flex-wrap justify-center gap-3.5 ltr:lg:justify-start rtl:lg:justify-end">
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-3 text-xs font-semibold text-black hover:bg-white/90 transition-all duration-200 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
            >
              {ctaPrimary}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-white/5 bg-white/5 px-5 py-3 text-xs font-semibold text-white/90 hover:text-white hover:border-white/10 hover:bg-white/10 transition-all duration-200"
            >
              {ctaSecondary}
            </Link>
            <Link
              href="/chart"
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-5 py-3 text-xs font-semibold text-violet-200 hover:bg-violet-500/20 transition-all duration-200"
            >
              {ctaChart}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>

        {/* Right Chat Sandbox (5 columns on desktop) */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="lg:col-span-5 rounded-2xl border border-white/5 bg-[#09090b]/40 p-2 backdrop-blur-md shadow-2xl shadow-violet-500/5 hover:border-white/10 transition-all duration-300"
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
