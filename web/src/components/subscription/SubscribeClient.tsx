"use client";

import Link from "next/link";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { useLocale } from "@/hooks/useLocale";

export function SubscribeClient({
  trialRemaining = 0,
  mode = "blocked",
}: {
  trialRemaining?: number;
  mode?: "trial" | "blocked" | "info";
}) {
  const { locale, dir } = useLocale();
  const isAr = locale === "ar";

  return (
    <div dir={dir} className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-10">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {isAr ? "الاشتراك" : "Subscription"}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {isAr ? AICHART_PLAN.titleAr : AICHART_PLAN.titleEn}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAr
            ? "وصول كامل إلى مساحة التداول والمحادثة والتنفيذ عبر MetaTrader."
            : "Full access to the trading workspace, conversation, and MetaTrader execution."}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold text-foreground">
            ${AICHART_PLAN.promotionalPriceUsd}
          </span>
          <span className="text-sm text-muted-foreground line-through">
            ${AICHART_PLAN.regularPriceUsd}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {isAr
            ? "السعر الحالي والسعر المعتاد. مدة الاشتراك يحددها المشرف بعد التفعيل."
            : "Current price and regular price. Entitlement duration is set by an administrator after activation."}
        </p>
        {mode === "trial" && trialRemaining > 0 ? (
          <p className="mt-3 text-sm text-foreground">
            {isAr
              ? `متبقي ${trialRemaining} من ${AICHART_PLAN.trialInteractions} تفاعلات تجريبية.`
              : `${trialRemaining} of ${AICHART_PLAN.trialInteractions} trial interactions remaining.`}
          </p>
        ) : null}
        {mode === "blocked" ? (
          <p className="mt-3 text-sm text-foreground">
            {isAr
              ? `استهلكت ${AICHART_PLAN.trialInteractions} تفاعلات تجريبية. فعّل الوصول الكامل للمتابعة.`
              : `You have used your ${AICHART_PLAN.trialInteractions} trial interactions. Activate full access to continue.`}
          </p>
        ) : null}
      </div>

      <a
        href={AICHART_PLAN.telegramUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="subscribe-telegram-cta"
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
      >
        {isAr ? "تواصل لتفعيل الاشتراك" : "Contact to subscribe"}
      </a>
      <p className="text-xs text-muted-foreground">
        {isAr
          ? `التفعيل عبر Telegram @${AICHART_PLAN.telegramHandle}. فتح الرابط لا يفعّل الاشتراك تلقائياً.`
          : `Activation via Telegram @${AICHART_PLAN.telegramHandle}. Opening the link does not activate the subscription.`}
      </p>
      <Link href="/console" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {isAr ? "العودة إلى المحادثة التجريبية" : "Back to trial chat"}
      </Link>
    </div>
  );
}
