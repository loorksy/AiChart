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
  amount: number;
  balance_after: number;
  note: string | null;
}

interface BalanceData {
  ok: boolean;
  billing_enforced: boolean;
  balance: number;
  plan_status: string;
  has_paid_access: boolean;
  expires_at: string | null;
  trial_used: number;
  trial_limit: number;
  trial_remaining: number;
  ledger: LedgerRow[];
}

interface PackRow {
  id: number;
  credits: number;
  price_cents: number;
}

/** Ledger kinds the API emits, mapped to their translation keys. */
const KIND_KEYS = {
  cycle_grant: "billing.kind.cycle_grant",
  topup: "billing.kind.topup",
  admin_adjust: "billing.kind.adjust",
  debit_recommendation: "billing.kind.debit_recommendation",
  debit_chat: "billing.kind.debit_chat",
  debit_mt5_link: "billing.kind.debit_mt5_link",
} as const satisfies Record<string, TranslationKey>;

/** Billing v3: the operator's CREDIT page — balance, packs, statement. */
export function BillingClient() {
  const { t, dir, locale } = useLocale();
  const [data, setData] = useState<BalanceData | null>(null);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    setError(null);
    try {
      const [balanceRes, packsRes] = await Promise.all([
        fetch("/api/billing/balance"),
        fetch("/api/billing/packs"),
      ]);
      if (balanceRes.ok) {
        setData((await balanceRes.json()) as BalanceData);
      } else {
        setError(t("billing.load_failed"));
        setLoadFailed(true);
      }
      if (packsRes.ok) {
        const p = (await packsRes.json()) as { packs?: PackRow[] };
        setPacks(p.packs ?? []);
      }
    } catch {
      setError(t("billing.network_failed"));
      setLoadFailed(true);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function buyPack(packId: number) {
    setBusy(`pack-${packId}`);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "topup", pack_id: packId }),
      });
      const out = (await res.json()) as {
        ok: boolean;
        url?: string;
        error?: { message?: string };
      };
      if (out.ok && out.url) {
        window.location.href = out.url;
        return;
      }
      setError(out.error?.message ?? t("billing.checkout_unavailable"));
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

  const statusLine = data.has_paid_access
    ? data.expires_at
      ? t("billing.pro_until", {
          date: new Date(data.expires_at).toLocaleDateString(locale),
        })
      : t("billing.status_active")
    : data.plan_status === "trial"
      // Free: no subscription, just a balance like everyone else.
      ? t("billing.status_free")
      : t("billing.refusal.subscription_expired");

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
          <p className="type-caption">{t("billing.preview_mode")}</p>
        </Surface>
      )}

      <section className="grid gap-4 sm:grid-cols-2" aria-label={t("billing.balances")}>
        <Surface padding="lg">
          <p className="type-caption">{t("billing.credit_balance")}</p>
          <p
            className="mt-1 text-3xl font-extrabold tabular-nums text-foreground"
            dir="ltr"
            data-testid="credit-balance"
          >
            {data.balance}
          </p>
        </Surface>
        <Surface padding="lg">
          <p className="type-caption">{t("billing.account_state")}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{statusLine}</p>
        </Surface>
      </section>

      <Surface as="section" padding="lg">
        <SectionHeader title={t("billing.add_credit")} />
        {/* The purchase contract, IN WRITING before any buy button: credits
            are spendable while the subscription is live; expiry freezes the
            balance (it is kept, and usable again on renewal). */}
        <p className="type-caption mt-1" data-testid="topup-disclosure">
          {t("billing.topup_disclosure")}
        </p>
        {data.has_paid_access ? (
          packs.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {packs.map((pack) => (
                <Button
                  key={pack.id}
                  variant="outline"
                  size="xl"
                  onClick={() => buyPack(pack.id)}
                  disabled={busy != null}
                >
                  {busy === `pack-${pack.id}`
                    ? t("billing.working")
                    : t("billing.pack_button", {
                        credits: String(pack.credits),
                        price: (pack.price_cents / 100).toFixed(2),
                      })}
                </Button>
              ))}
            </div>
          ) : (
            <p className="type-caption mt-3">{t("billing.no_packs")}</p>
          )
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="type-caption">{t("billing.topup_needs_active")}</p>
            <Link href="/subscribe" className={cn(buttonVariants({ size: "lg" }))}>
              {data.plan_status === "trial"
                ? t("billing.cta.subscribe")
                : t("billing.cta.renew")}
            </Link>
          </div>
        )}
        {data.has_paid_access && (
          <div className="mt-4 border-t border-border pt-4">
            <Button size="lg" variant="outline" onClick={openPortal} disabled={busy != null}>
              {busy === "portal" ? t("billing.working") : t("billing.manage_subscription")}
            </Button>
          </div>
        )}
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
                    row.amount < 0 ? "text-sell" : "text-buy",
                  )}
                  dir="ltr"
                >
                  {row.amount < 0 ? "" : "+"}
                  {row.amount}
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
