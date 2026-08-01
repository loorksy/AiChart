"use client";

import { useCallback, useEffect, useState } from "react";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";

interface LedgerRow {
  ts: number;
  kind: string;
  amount_usd: number;
  bucket: string;
  note: string | null;
}

interface BalanceData {
  ok: boolean;
  billing_enforced: boolean;
  balance: { monthlyUsd: number; topupUsd: number; totalUsd: number; periodEnd: number | null };
  subscription: {
    tier: string;
    tier_name_ar: string;
    status: string;
    period_end: number;
  } | null;
  ledger: LedgerRow[];
}

const KIND_LABELS: Record<string, string> = {
  monthly_grant: "منحة الباقة الشهرية",
  trial_grant: "رصيد التجربة",
  gift: "شهر هدية",
  topup: "شحن رصيد",
  burn: "استهلاك",
  adjust: "تعديل إداري",
};

const fmtUsd = (v: number) =>
  `$${Math.abs(v).toFixed(Math.abs(v) < 1 ? 3 : 2)}`;

/** V2-A5 (#94): the operator's money page — balance, statement, actions. */
export function BillingClient() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/balance");
      if (res.ok) setData((await res.json()) as BalanceData);
      else setError("تعذّر تحميل بيانات الفوترة.");
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function topup(amount: number) {
    setBusy(`topup-${amount}`);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topup_usd: amount }),
      });
      const out = (await res.json()) as { ok: boolean; url?: string; message?: string };
      if (out.ok && out.url) {
        window.location.href = out.url;
        return;
      }
      setError(out.message ?? "الدفع غير مفعَّل بعد.");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const out = (await res.json()) as { ok: boolean; url?: string };
      if (out.ok && out.url) {
        window.location.href = out.url;
        return;
      }
      setError("بوابة الإدارة غير متاحة (لا اشتراك Stripe نشط).");
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">الفوترة والاستخدام</h1>
        <CardSkeleton lines={4} />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">الفوترة والاستخدام</h1>
        <a
          href="/pricing"
          className="text-sm font-medium text-primary hover:underline"
        >
          عرض الباقات
        </a>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!data.billing_enforced && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          نظام الرصيد في وضع المعاينة — لا يُفرض أي خصم حالياً.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">الرصيد الكلي</p>
          <p className="mt-1 text-3xl font-extrabold text-foreground">
            {fmtUsd(data.balance.totalUsd)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">رصيد الباقة الشهري</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {fmtUsd(data.balance.monthlyUsd)}
          </p>
          {data.balance.periodEnd && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              يتجدد {new Date(data.balance.periodEnd).toLocaleDateString("ar")}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">رصيد الشحن (لا ينتهي)</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {fmtUsd(data.balance.topupUsd)}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {data.subscription
                ? `باقة ${data.subscription.tier_name_ar} — ${data.subscription.status === "active" ? "نشطة" : data.subscription.status}`
                : "لا يوجد اشتراك نشط"}
            </p>
            {data.subscription && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                التجديد: {new Date(data.subscription.period_end).toLocaleDateString("ar")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {[20, 50, 100].map((amount) => (
              <button
                key={amount}
                onClick={() => topup(amount)}
                disabled={busy != null}
                className="inline-flex min-h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                {busy === `topup-${amount}` ? "…" : `شحن $${amount}`}
              </button>
            ))}
            {data.subscription && (
              <button
                onClick={openPortal}
                disabled={busy != null}
                className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy === "portal" ? "…" : "إدارة الاشتراك"}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
          كشف الحركة (آخر 50)
        </h2>
        {data.ledger.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            لا حركة بعد — أول تحليل سيظهر هنا.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.ledger.map((row, i) => (
              <li key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <div>
                  <span className="text-foreground">
                    {KIND_LABELS[row.kind] ?? row.kind}
                  </span>
                  <span className="mx-2 text-[11px] text-muted-foreground">
                    {new Date(row.ts).toLocaleString("ar")}
                  </span>
                </div>
                <span
                  className={
                    row.amount_usd < 0 ? "font-medium text-destructive" : "font-medium text-emerald-500"
                  }
                >
                  {row.amount_usd < 0 ? "-" : "+"}
                  {fmtUsd(row.amount_usd)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
