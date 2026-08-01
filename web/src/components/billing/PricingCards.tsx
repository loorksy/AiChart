"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
        <p role="alert" className="mx-auto mb-6 max-w-md rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {tiers.map((tier, i) => {
          const highlight = tier.id === "pro";
          return (
            <div
              key={tier.id}
              className={`relative flex flex-col rounded-2xl border p-6 ${
                highlight
                  ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                  : "border-border bg-card"
              }`}
            >
              {highlight && (
                <span className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                  الأكثر اختياراً
                </span>
              )}
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-bold text-foreground">{tier.nameEn}</h3>
                <span className="text-xs text-muted-foreground">{tier.nameAr}</span>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-foreground">${tier.priceUsd}</span>
                <span className="text-sm text-muted-foreground">/شهرياً</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                رصيد استخدام <span className="font-semibold text-foreground">${tier.includedCreditsUsd}</span> كل شهر
              </p>

              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {featureRows.map((row) => {
                  const on =
                    row.key === "models" ? true : tier.features[row.key];
                  return (
                    <li
                      key={row.key}
                      className={`flex items-center gap-2 ${on ? "text-foreground" : "text-muted-foreground/50 line-through"}`}
                    >
                      <span aria-hidden>{on ? "✓" : "—"}</span>
                      {row.key === "models"
                        ? `${row.label} (${tier.modelCount === 8 ? "الكل" : tier.modelCount})`
                        : row.label}
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => subscribe(tier.id)}
                disabled={busy != null || !stripeReady}
                className={`mt-6 inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border bg-background text-foreground hover:bg-muted"
                }`}
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
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  تجربة مجانية برصيد محدود عند التسجيل
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
