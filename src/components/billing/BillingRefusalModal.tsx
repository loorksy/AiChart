"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { buttonVariants, Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/**
 * The ONE refusal modal — one message, one action, no lectures. It always
 * outranks any advertisement on screen.
 *
 * The SERVER decides both the sentence and the button, because the same
 * code means different things to different accounts: an empty balance sends
 * a Free account to subscribe (top-ups are sold to subscribers only) and a
 * subscriber to the top-up page. Re-deriving that here is exactly how the
 * surfaces drifted apart before.
 */
export interface BillingRefusalView {
  message: string;
  ctaLabel: string;
  ctaPath: string;
}

export function BillingRefusalModal({
  refusal,
  onClose,
}: {
  refusal: BillingRefusalView;
  onClose: () => void;
}) {
  const { t, dir } = useLocale();

  return (
    <div
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-refusal-title"
      data-refusal-modal=""
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-card p-6 elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="billing-refusal-title" className="text-base font-semibold text-foreground">
            {refusal.message}
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
          href={refusal.ctaPath}
          className={cn(buttonVariants({ size: "lg" }), "mt-5 w-full")}
          data-testid="billing-refusal-cta"
        >
          {refusal.ctaLabel}
        </Link>
      </div>
    </div>
  );
}
