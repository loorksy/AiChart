/**
 * Share icon that opens the profit-card sheet immediately.
 * Safe inside a Link: preventDefault + stopPropagation, 44px hit target.
 */
"use client";

import { useState } from "react";
import { Share2, Receipt } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useMe } from "@/hooks/useMe";
import { displayNameForUser } from "@/lib/displayName";
import { cn } from "@/lib/utils";
import type { ProfitCardSource } from "@/lib/recommendations/profitCard";
import { ShareProfitCardModal } from "@/components/recommendations/ShareProfitCardModal";

export function ShareProfitButton({
  rec,
  livePrice,
  className,
  variant = "icon",
}: {
  rec: ProfitCardSource;
  livePrice?: number | null;
  className?: string;
  /** "result" is the labeled PnL action next to a recommendation share. */
  variant?: "icon" | "result";
}) {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();
  const { data } = useMe();
  const displayName = data?.user
    ? displayNameForUser(data.user)
    : (data?.displayName ?? null);
  const result = variant === "result";
  const Icon = result ? Receipt : Share2;

  return (
    <>
      <button
        type="button"
        data-testid={result ? "share-profit-card-result" : "share-profit-card"}
        aria-label={result ? t("profit_card.share_result") : t("profit_card.share")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        className={cn(
          "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
          "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "sm:size-8",
          className,
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </button>
      <ShareProfitCardModal
        open={open}
        onClose={() => setOpen(false)}
        rec={rec}
        livePrice={livePrice}
        displayName={displayName}
      />
    </>
  );
}
