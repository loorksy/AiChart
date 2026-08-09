"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ReceiptText, RotateCw, Wallet } from "lucide-react";

import { EmptyState, PageHeader, SectionHeader, Surface } from "@/components/foundation";
import { useLocale } from "@/hooks/useLocale";
import { Button, buttonVariants } from "@/components/squareui/button";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

/** Ledger kinds the API emits, mapped to their translation keys. */
const KIND_KEYS = {
  monthly_grant: "billing.kind.monthly_grant",
  trial_grant: "billing.kind.trial_grant",
  gift: "billing.kind.gift",
  topup: "billing.kind.topup",
  burn: "billing.kind.burn",
  adjust: "billing.kind.adjust",
} as const satisfies Record<string, TranslationKey>;

const TOPUP_AMOUNTS = [20, 50, 100];

const fmtUsd = (v: number) =>
  `$${Math.abs(v).toFixed(Math.abs(v) < 1 ? 3 : 2)}`;

/** V2-A5 (#94): the operator's money page — balance, statement, actions. */
export function BillingClient() {
  const { t, dir, locale } = useLocale();
  const [data, setData] = useState<BalanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    setError(null);
    try {
      const res = await fetch("/api/billing/balance");
      if (res.ok) {
        setData((await res.json()) as BalanceData);
      } else {
        setError(t("billing.load_failed"));
        setLoadFailed(true);
      }
    } catch {
      setError(t("billing.network_failed"));
      setLoadFailed(true);
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
      setError(out.message ?? t("billing.checkout_unavailable"));
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
      setError(t("billing.portal_unavailable"));
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <PageHeader
      title={t("billing.title")}
      description={t("billing.subtitle")}
      icon={<Wallet aria-hidden="true" />}
      actions={
        <Link
          href="/pricing"
          className={cn(buttonVariants({ variant: "outline", size: "xl" }))}
        >
          {t("billing.view_plans")}
        </Link>
      }
    />
  );

  // A failed first load used to fall through to the skeleton branch forever —
  // the error was set but the early return never rendered it. Give it a way out.
  if (!data) {
    return (
      <div className="space-y-6" dir={dir}>
        {header}
        {loadFailed ? (
          <Surface padding="none">
            <EmptyState
              announce
              tone="danger"
              icon={<AlertTriangle aria-hidden="true" />}
              title={t("billing.load_failed_title")}
              description={error ?? t("billing.unexpected")}
              action={
                <Button size="xl" onClick={() => void load()}>
                  <RotateCw aria-hidden="true" />
                  {t("billing.retry")}
                </Button>
              }
            />
          </Surface>
        ) : (
          <div className="space-y-4" aria-busy="true" aria-live="polite">
            <span className="sr-only">{t("billing.loading")}</span>
            <CardSkeleton lines={4} />
            <CardSkeleton lines={6} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={dir}>
      {header}

      {error && (
        <Surface
          role="alert"
          padding="sm"
          className="border-destructive/30 bg-destructive/10"
        >
          <p className="type-caption text-destructive">{error}</p>
        </Surface>
      )}

      {!data.billing_enforced && (
        <Surface padding="sm" className="bg-muted/40">
          <p className="type-caption">
            {t("billing.preview_mode")}
          </p>
        </Surface>
      )}

      <section className="grid gap-4 sm:grid-cols-3" aria-label={t("billing.balances")}>
        <Surface padding="lg">
          <p className="type-caption">{t("billing.total_balance")}</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums text-foreground">
            {fmtUsd(data.balance.totalUsd)}
          </p>
        </Surface>
        <Surface padding="lg">
          <p className="type-caption">{t("billing.monthly_balance")}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {fmtUsd(data.balance.monthlyUsd)}
          </p>
          {data.balance.periodEnd && (
            <p className="type-caption mt-1">
              {t("billing.renews_on", {
                date: new Date(data.balance.periodEnd).toLocaleDateString(locale),
              })}
            </p>
          )}
        </Surface>
        <Surface padding="lg">
          <p className="type-caption">{t("billing.topup_balance")}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {fmtUsd(data.balance.topupUsd)}
          </p>
        </Surface>
      </section>

      <Surface as="section" padding="lg">
        <SectionHeader
          title={
            data.subscription
              ? t("billing.plan_line", {
                  tier: data.subscription.tier_name_ar,
                  status:
                    data.subscription.status === "active"
                      ? t("billing.status_active")
                      : data.subscription.status,
                })
              : t("billing.no_subscription")
          }
          description={
            data.subscription
              ? t("billing.renewal", {
                  date: new Date(data.subscription.period_end).toLocaleDateString(locale),
                })
              : undefined
          }
        />

        {/* Dedicated action row — actions live under the subscription line,
            not squeezed into the SectionHeader. */}
        {data.subscription && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="xl" onClick={openPortal} disabled={busy != null}>
              {busy === "portal" ? t("billing.working") : t("billing.manage_subscription")}
            </Button>
          </div>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <p className="type-overline">{t("billing.add_credit")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {TOPUP_AMOUNTS.map((amount) => (
              <Button
                key={amount}
                variant="outline"
                size="xl"
                onClick={() => topup(amount)}
                disabled={busy != null}
              >
                {busy === `topup-${amount}`
                  ? t("billing.working")
                  : t("billing.topup_amount", { amount: String(amount) })}
              </Button>
            ))}
          </div>
        </div>
      </Surface>

      <Surface as="section" padding="none">
        <SectionHeader
          title={t("billing.statement")}
          className="border-b border-border px-5 py-3"
        />
        {data.ledger.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<ReceiptText aria-hidden="true" />}
            title={t("billing.statement_empty_title")}
            description={t("billing.statement_empty")}
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {data.ledger.map((row, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 py-3 text-sm"
              >
                {/* Wrapping row + min-w-0: at 375px the timestamp drops to its
                    own line instead of shoving the amount off-screen. */}
                <span className="min-w-0 flex-1 text-foreground">
                  {row.kind in KIND_KEYS
                    ? t(KIND_KEYS[row.kind as keyof typeof KIND_KEYS])
                    : row.kind}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-medium tabular-nums",
                    row.amount_usd < 0 ? "text-sell" : "text-buy",
                  )}
                >
                  {row.amount_usd < 0 ? "-" : "+"}
                  {fmtUsd(row.amount_usd)}
                </span>
                <time
                  dateTime={new Date(row.ts).toISOString()}
                  className="type-caption w-full"
                >
                  {new Date(row.ts).toLocaleString(locale)}
                </time>
              </li>
            ))}
          </ul>
        )}
        {data.ledger.length >= 50 && (
          <p className="type-caption border-t border-border/60 px-5 py-2">
            {t("billing.statement_truncated")}
          </p>
        )}
      </Surface>
    </div>
  );
}
