"use client";

import { Cloud, Laptop, Loader2 } from "lucide-react";

import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

export type ForexMethod = "platform" | "ea";

/**
 * How the trader's own forex account connects:
 *  - "platform": server-side, running whether or not their machine is on
 *  - "ea": the bridge installed in their own MetaTrader terminal
 *
 * This is the switch `connectMtAccount` refers to when it refuses a cloud link
 * with «بدّل الطريقة إلى «عبر المنصة» أولاً». It writes trading_settings
 * .forex_backend, which is the only thing that can override the deployment-wide
 * FOREX_BACKEND default — so until this was mounted, that error named a control
 * that did not exist anywhere in the product.
 *
 * Both routes stay fully supported; this only decides which one serves THIS
 * account.
 */
export function ForexMethodSelector({
  method,
  platformAvailable,
  saving,
  onChoose,
}: {
  method: ForexMethod;
  platformAvailable: boolean;
  saving: boolean;
  onChoose: (method: ForexMethod) => void;
}) {
  const { t } = useLocale();

  const option = (
    id: ForexMethod,
    Icon: typeof Cloud,
    title: string,
    body: string,
    disabled: boolean,
    note?: string,
  ) => (
    <button
      type="button"
      disabled={saving || disabled}
      onClick={() => onChoose(id)}
      aria-pressed={method === id}
      className={cn(
        "focus-ring flex flex-col items-start gap-1 rounded-xl border p-3 text-start transition-colors duration-150",
        method === id
          ? "border-primary bg-primary/10"
          : "border-border bg-background/60 hover:bg-muted/50",
        (disabled || saving) && "cursor-not-allowed opacity-60",
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4 text-primary" aria-hidden />
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </span>
      <span className="text-xs text-muted-foreground">{body}</span>
      {note && (
        <span className="mt-1 text-[11px] font-medium text-warning">{note}</span>
      )}
    </button>
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">
            {t("connect.method.title")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("connect.method.subtitle")}
          </p>
        </div>
        {saving && (
          <Loader2
            className="size-4 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {option(
          "platform",
          Cloud,
          t("connect.method.platform"),
          t("connect.method.platform_body"),
          !platformAvailable,
          platformAvailable ? undefined : t("connect.method.platform_off"),
        )}
        {/* EA needs no server-side infrastructure, so it is always selectable. */}
        {option(
          "ea",
          Laptop,
          t("connect.method.ea"),
          t("connect.method.ea_body"),
          false,
        )}
      </div>
    </div>
  );
}
