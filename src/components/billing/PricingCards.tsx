"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { Surface } from "@/components/foundation";
import { Button, buttonVariants } from "@/components/squareui/button";
// Existing contact destination — used only when Stripe checkout is not
// configured, replacing the former dead disabled button (spec §3 /pricing).
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { cn } from "@/lib/utils";

/** The one plan's admin-set facts, resolved server-side — never constants. */
export interface PlanCardFacts {
  priceCents: number | null;
  creditsPerCycle: number | null;
  trialLimit: number;
  trialDurationMinutes: number;
}

/** Billing v3: ONE plan card + checkout kick-off. */
export function PricingCards({
  plan,
  signedIn,
  stripeReady,
}: {
  plan: PlanCardFacts;
  signedIn: boolean;
  stripeReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subscribe() {
    if (!signedIn) {
      router.push(`/signup?next=/pricing`);
      return;
    }
    setBusy("plan");
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "subscription" }),
      });
      const data = (await res.json()) as { ok: boolean; url?: string; message?: string };
      if (data.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setError(data.message ?? "تعذّر بدء الدفع — حاول مجدداً.");
    } catch {
      setError("تعذّر الاتصال بخادم الدفع.");
    } finally {
      setBusy(null);
    }
  }

  // One plan = every feature. The list is descriptive, not comparative.
  const featureRows: Array<{ key: string; label: string }> = [
    { key: "models", label: "كل مودلات الذكاء الاصطناعي" },
    { key: "telegramBot", label: "وكيل التوصيات عبر تليجرام" },
    { key: "trackedRecommendations", label: "تتبّع كل توصية حتى نتيجتها" },
    { key: "mt5", label: "ربط حساب MT5 والتنفيذ اليدوي" },
    { key: "prioritySupport", label: "أولوية الدعم" },
  ];
  const priceUsd = plan.priceCents != null ? plan.priceCents / 100 : null;

  return (
    <div className="mt-10">
      {error && (
        <p
          role="alert"
          className="mx-auto mb-6 max-w-md rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="mx-auto grid max-w-md gap-6">
        <Surface
          as="section"
          aria-labelledby="plan-card"
          padding="lg"
          elevation={3}
          className={cn(
            "relative flex flex-col",
            // Brand-premium gold — this highlight is one of the few legal
            // consumers of --accent-gold (spec §1).
            "border-accent-gold/70 bg-accent-gold/5",
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="plan-card" className="text-lg font-bold text-foreground">
              {AICHART_PLAN.titleEn}
            </h3>
            <span className="type-caption">{AICHART_PLAN.titleAr}</span>
          </div>
          {priceUsd != null ? (
            <p className="mt-4 flex items-baseline gap-1">
              <span className="font-serif text-4xl font-bold tabular-nums text-foreground" dir="ltr">
                ${priceUsd}
              </span>
              <span className="type-caption">/شهرياً</span>
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              التسعير قيد الإعداد — تواصل معنا لتفعيل الاشتراك.
            </p>
          )}
          {plan.creditsPerCycle != null && plan.creditsPerCycle > 0 ? (
            <p className="type-caption mt-2">
              <span className="font-semibold text-foreground" dir="ltr">
                {plan.creditsPerCycle}
              </span>{" "}
              كريدت كل دورة — والمتبقي يُرحَّل مع التجديد
            </p>
          ) : null}

          <ul className="mt-6 flex-1 space-y-2.5 text-sm">
            {featureRows.map((row) => (
              <li key={row.key} className="flex items-center gap-2 text-foreground">
                <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span>{row.label}</span>
              </li>
            ))}
          </ul>

          {stripeReady && priceUsd != null ? (
            <Button
              type="button"
              variant="default"
              size="xl"
              className="mt-6 w-full font-semibold"
              onClick={() => subscribe()}
              disabled={busy != null}
              aria-busy={busy === "plan"}
            >
              {busy === "plan" ? "جارٍ التحويل…" : signedIn ? "اشترك الآن" : "ابدأ الآن"}
            </Button>
          ) : (
            // No checkout configured → a live contact link instead of a
            // dead disabled button. Same destination the platform already
            // uses for manual activation.
            <a
              href={AICHART_PLAN.telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({
                variant: "default",
                size: "xl",
                className: "mt-6 w-full font-semibold",
              })}
            >
              تواصل لتفعيل الاشتراك
            </a>
          )}
          <p className="type-caption mt-3 text-center">
            تجربة مجانية بكل المزايا — حتى {plan.trialLimit} توصيات
            {plan.trialDurationMinutes > 0 ? " وضمن مدة محدودة" : ""}.
          </p>
        </Surface>
      </div>
    </div>
  );
}
