"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus } from "lucide-react";

import { Surface } from "@/components/foundation";
import { cn } from "@/lib/utils";

interface TierCard {
  id: string;
  nameEn: string;
  nameAr: string;
  priceUsd: number;
  includedCreditsUsd: number;
  features: {
    mt5Link: boolean;
    liveExecution: boolean;
    voice: boolean;
    scalpEngine: boolean;
    prioritySupport: boolean;
  };
  modelCount: number;
}

/** V2-A5 (#94): the four tier cards + checkout kick-off. */
export function PricingCards({
  tiers,
  signedIn,
  stripeReady,
}: {
  tiers: TierCard[];
  signedIn: boolean;
  stripeReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subscribe(tierId: string) {
    if (!signedIn) {
      router.push(`/signup?next=/pricing`);
      return;
    }
    setBusy(tierId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierId }),
      });
      const data = (await res.json()) as { ok: boolean; url?: string; message?: string };
      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.message ?? "تعذّر بدء الدفع — حاول مجدداً.");
    } catch {
      setError("تعذّر الاتصال بخادم الدفع.");
    } finally {
      setBusy(null);
    }
  }

  const featureRows: Array<{ key: keyof TierCard["features"] | "models"; label: string }> = [
    { key: "models", label: "مودلات الذكاء الاصطناعي" },
    { key: "mt5Link", label: "ربط حساب MT5" },
    { key: "liveExecution", label: "تنفيذ الصفقات الحي" },
    { key: "scalpEngine", label: "محرك السكالب الآلي" },
    { key: "voice", label: "الوكيل الصوتي" },
    { key: "prioritySupport", label: "أولوية الدعم" },
  ];

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
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {tiers.map((tier, i) => {
          const highlight = tier.id === "pro";
          const headingId = `tier-${tier.id}`;
          return (
            <Surface
              key={tier.id}
              as="section"
              aria-labelledby={headingId}
              padding="lg"
              elevation={highlight ? 3 : 1}
              className={cn(
                "relative flex flex-col",
                highlight && "border-primary bg-primary/5",
              )}
            >
              {highlight && (
                // Logical inset so the ribbon mirrors with the document
                // direction instead of pinning itself to the right edge.
                <span className="absolute -top-3 end-6 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                  الأكثر اختياراً
                </span>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <h3 id={headingId} className="text-lg font-bold text-foreground">
                  {tier.nameEn}
                </h3>
                <span className="type-caption">{tier.nameAr}</span>
              </div>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tabular-nums text-foreground">
                  ${tier.priceUsd}
                </span>
                <span className="type-caption">/شهرياً</span>
              </p>
              <p className="type-caption mt-2">
                رصيد استخدام{" "}
                <span className="font-semibold text-foreground">
                  ${tier.includedCreditsUsd}
                </span>{" "}
                كل شهر
              </p>

              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {featureRows.map((row) => {
                  const on = row.key === "models" ? true : tier.features[row.key];
                  return (
                    <li
                      key={row.key}
                      className={cn(
                        "flex items-center gap-2",
                        on ? "text-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {on ? (
                        <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                      ) : (
                        <Minus aria-hidden="true" className="size-4 shrink-0" />
                      )}
                      {/* Strike-through and a glyph are both visual-only; name
                          the state so it survives a screen reader. */}
                      <span className="sr-only">{on ? "مضمّن:" : "غير مضمّن:"}</span>
                      <span className={cn(!on && "line-through")}>
                        {row.key === "models"
                          ? `${row.label} (${tier.modelCount === 8 ? "الكل" : tier.modelCount})`
                          : row.label}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => subscribe(tier.id)}
                disabled={busy != null || !stripeReady}
                aria-busy={busy === tier.id}
                className={cn(
                  "mt-6 inline-flex min-h-11 items-center justify-center rounded-[var(--radius)] px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                {busy === tier.id
                  ? "جارٍ التحويل…"
                  : stripeReady
                    ? signedIn
                      ? "اشترك الآن"
                      : "ابدأ الآن"
                    : "قريباً — تواصل مع الإدارة"}
              </button>
              {i === 0 && (
                <p className="type-caption mt-3 text-center">
                  تجربة مجانية برصيد محدود عند التسجيل
                </p>
              )}
            </Surface>
          );
        })}
      </div>
    </div>
  );
}
