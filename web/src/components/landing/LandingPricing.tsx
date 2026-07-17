"use client";

import { AICHART_PLAN } from "@/lib/subscription/plan";
import { useLocale } from "@/hooks/useLocale";

export function LandingPricing() {
  const { locale, dir } = useLocale();
  const isAr = locale === "ar";

  return (
    <section
      id="pricing"
      dir={dir}
      data-testid="landing-pricing"
      className="border-t border-border px-4 py-16 sm:px-6"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {isAr ? "الاشتراك" : "Pricing"}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {isAr ? AICHART_PLAN.titleAr : AICHART_PLAN.titleEn}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          {isAr
            ? "خطة واحدة للوصول الكامل إلى مساحة AiChart. التفعيل يدوي بعد التواصل."
            : "One plan for full AiChart access. Activation is manual after contact."}
        </p>
        <div className="mx-auto mt-8 max-w-sm rounded-xl border border-border bg-background px-6 py-8 text-start shadow-sm">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-semibold text-foreground">
              ${AICHART_PLAN.promotionalPriceUsd}
            </span>
            <span className="text-base text-muted-foreground line-through">
              ${AICHART_PLAN.regularPriceUsd}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {isAr
              ? "السعر الحالي والسعر المعتاد — دون ادّعاء مدة فوترة غير مُعدّة."
              : "Current price and regular price — no fabricated billing period."}
          </p>
          <ul className="mt-5 space-y-2 text-sm text-foreground">
            <li>{isAr ? "الشارت ومساحة المحادثة" : "Chart and conversation workspace"}</li>
            <li>{isAr ? "توصيات وسجل وإحصائيات" : "Recommendations, history, and statistics"}</li>
            <li>{isAr ? "تنفيذ MetaTrader بعد الموافقة" : "MetaTrader execution after approval"}</li>
            <li>{isAr ? "تجربة محدودة: 3 تفاعلات مجانية" : "Limited trial: 3 free interactions"}</li>
          </ul>
          <a
            href={AICHART_PLAN.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-subscribe-cta"
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-foreground text-sm font-medium text-background"
          >
            {isAr ? "تواصل لتفعيل الاشتراك" : "Contact to subscribe"}
          </a>
        </div>
      </div>
    </section>
  );
}
