"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { buttonVariants, Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/**
 * The ONE refusal modal — the three account states, never blurred:
 * expired → renew; empty balance (active sub) → buy credits; trial
 * exhausted → subscribe. One message, one action, no lectures. This modal
 * always outranks any advertisement on screen.
 */
export type BillingRefusalCode =
  | "subscription_expired"
  | "insufficient_credits"
  | "trial_exhausted";

const ACTION: Record<BillingRefusalCode, { href: string; ctaKey: string }> = {
  subscription_expired: { href: "/subscribe", ctaKey: "billing.cta.renew" },
  insufficient_credits: { href: "/console/billing", ctaKey: "billing.cta.topup" },
  trial_exhausted: { href: "/subscribe", ctaKey: "billing.cta.subscribe" },
};

export function BillingRefusalModal({
  code,
  onClose,
}: {
  code: BillingRefusalCode;
  onClose: () => void;
}) {
  const { t, dir } = useLocale();
  const action = ACTION[code];

  return (
    <div
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-refusal-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-card p-6 elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="billing-refusal-title" className="text-base font-semibold text-foreground">
            {t(`billing.refusal.${code}`)}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("shell.close")}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <Link
          href={action.href}
          className={cn(buttonVariants({ size: "lg" }), "mt-5 w-full")}
          data-testid="billing-refusal-cta"
        >
          {t(action.ctaKey)}
        </Link>
      </div>
    </div>
  );
}
