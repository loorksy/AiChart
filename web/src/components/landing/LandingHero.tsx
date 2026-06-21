"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { VercelV0Chat } from "@/components/ui/v0-ai-chat";
import { useLocale } from "@/components/LocaleProvider";

export function LandingHero() {
  const router = useRouter();
  const { locale } = useLocale();

  function handleSend(text: string) {
    sessionStorage.setItem("aichart_pending_prompt", text);
    router.push("/signup");
  }

  const tagline = locale === "ar"
    ? "منصة تداول ذكية — Claude MCP · Binance · MT5"
    : "AI-Powered Trading Assistant — Claude MCP · Binance · MT5";

  const title = locale === "ar"
    ? "تداول بذكاء عبر Claude MCP"
    : "Trade Smartly with Claude MCP";

  const subtitle = locale === "ar"
    ? "اربط Claude Connectors بحسابك، راقب السوق، ونفّذ الصفقات عبر Binance وMetaTrader — مع Risk Guard وموافقة إدارية."
    : "Connect Claude Connectors, monitor markets, and execute trades on Binance & MetaTrader 5 — backed by Risk Guard and admin controls.";

  const ctaPrimary = locale === "ar" ? "ابدأ مجاناً" : "Start Free";
  const ctaSecondary = locale === "ar" ? "تسجيل الدخول" : "Sign In";
  const chatTitle = locale === "ar" ? "ماذا ستتداول اليوم؟" : "What are we trading today?";
  const chatSubtitle = locale === "ar"
    ? "جرب سؤالاً — سجّل لربط Claude MCP والتداول الحقيقي."
    : "Try a prompt — register to link Claude MCP and begin real trading.";

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="space-y-6 text-center ltr:lg:text-left rtl:lg:text-right">
          <p className="text-sm font-semibold text-primary tracking-wide uppercase">{tagline}</p>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl lg:text-5xl text-foreground">
            {title}
          </h1>
          <p className="text-base text-muted-foreground sm:text-lg leading-relaxed">
            {subtitle}
          </p>
          <div className="flex flex-wrap justify-center gap-3 ltr:lg:justify-start rtl:lg:justify-end">
            <Link href="/signup" className="btn btn-primary inline-flex gap-1">
              {ctaPrimary}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn btn-secondary">
              {ctaSecondary}
            </Link>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card/50 p-2 backdrop-blur-sm shadow-xl">
          <VercelV0Chat
            title={chatTitle}
            subtitle={chatSubtitle}
            onSend={handleSend}
          />
        </div>
      </div>
    </section>
  );
}
