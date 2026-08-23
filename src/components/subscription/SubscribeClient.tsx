"use client";

import Link from "next/link";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { buttonVariants } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/** Admin-set plan facts, resolved server-side and passed down — never constants. */
export interface SubscribePlanFacts {
  priceCents: number | null;
  /** Credits a new account is handed once — the only "free" the product has. */
  signupGrantCredits: number;
}

export function SubscribeClient({
  mode = "blocked",
  plan,
}: {
  /** `free` = never subscribed; `blocked` = suspended or lapsed. */
  mode?: "free" | "blocked" | "info";
  plan: SubscribePlanFacts;
}) {
  const { locale, dir, t } = useLocale();
  const isAr = locale === "ar";
  const price = plan.priceCents != null ? plan.priceCents / 100 : null;

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
            ? "وصول كامل إلى مساحة التداول والمحادثة وتحليل الذهب عبر OANDA."
            : "Full access to the trading workspace, conversation, and gold analysis."}
        </p>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5 elevation-1">
        {price != null ? (
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold text-foreground" dir="ltr">
              ${price}
            </span>
            <span className="text-sm text-muted-foreground">
              {isAr ? "شهرياً" : "/month"}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("billing.pricing_pending")}</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {isAr
            ? "اشتراك شهري واحد يفتح كل الميزات."
            : "One monthly subscription unlocks every feature."}
        </p>
        {mode === "free" && plan.signupGrantCredits > 0 ? (
          <p className="mt-3 text-sm text-foreground">
            {t("billing.signup_grant_note", {
              credits: String(plan.signupGrantCredits),
            })}
          </p>
        ) : null}
        {mode === "blocked" ? (
          <p className="mt-3 text-sm text-foreground">{t("billing.blocked_cta")}</p>
        ) : null}
      </div>

      <a
        href={AICHART_PLAN.telegramUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="subscribe-telegram-cta"
        className={cn(buttonVariants({ size: "xl" }), "w-full")}
      >
        {isAr ? "تواصل لتفعيل الاشتراك" : "Contact to subscribe"}
      </a>
      <p className="text-xs text-muted-foreground">
        {isAr
          ? `التفعيل عبر Telegram @${AICHART_PLAN.telegramHandle}. فتح الرابط لا يفعّل الاشتراك تلقائياً.`
          : `Activation via Telegram @${AICHART_PLAN.telegramHandle}. Opening the link does not activate the subscription.`}
      </p>
      <Link href="/chat" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {isAr ? "العودة إلى المنصة" : "Back to the workspace"}
      </Link>
    </div>
  );
}
