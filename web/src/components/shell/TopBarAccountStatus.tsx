"use client";

/**
 * Mode + broker connection + MT equity for the top bar (N18 / N12).
 * Subscription credit stays in BalanceChip — these must never be conflated.
 */
import { Bot, Wifi, WifiOff } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useTradeMode } from "@/hooks/useTradeMode";
import { useAccountCapital } from "@/hooks/useAccountCapital";
import { cn } from "@/lib/utils";

export function TopBarAccountStatus() {
  const { t } = useLocale();
  const { view } = useTradeMode();
  const capital = useAccountCapital();

  if (!view) return null;

  const mode = view.mode;
  const modeLabel =
    mode === "auto"
      ? t("trade_mode.mode.auto")
      : mode === "advisory"
        ? t("trade_mode.mode.advisory")
        : t("trade_mode.mode.unset");

  return (
    <div
      data-testid="topbar-account-status"
      className="flex min-h-9 shrink-0 items-center gap-1.5 text-[11px] font-semibold"
    >
      <span
        data-testid="topbar-trade-mode"
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
          mode === "auto"
            ? "border-buy/45 bg-buy/10 text-buy"
            : mode === "advisory"
              ? "border-info/40 bg-info/10 text-info"
              : "border-border bg-muted/40 text-muted-foreground",
        )}
        title={modeLabel}
      >
        <Bot className="h-3 w-3" aria-hidden />
        <span className="hidden sm:inline">{modeLabel}</span>
      </span>

      <span
        data-testid="topbar-broker-status"
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
          view.connected
            ? "border-border text-muted-foreground"
            : "border-warning/40 text-warning",
        )}
        title={
          view.connected
            ? t("layout.mt_connected")
            : t("trade_mode.disconnected")
        }
      >
        {view.connected ? (
          <Wifi className="h-3 w-3" aria-hidden />
        ) : (
          <WifiOff className="h-3 w-3" aria-hidden />
        )}
        <span className="hidden md:inline">
          {view.connected ? t("layout.mt_connected") : t("layout.mt_disconnected")}
        </span>
      </span>

      {capital.connected && capital.amount != null && (
        <span
          data-testid="topbar-mt-equity"
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 tabular-nums text-muted-foreground"
          title={t("balance.mt_equity")}
          dir="ltr"
        >
          <span className="hidden sm:inline text-[10px] font-medium opacity-70">
            {t("balance.mt_equity_short")}
          </span>
          ${Math.round(capital.amount).toLocaleString()}{" "}
          {capital.currency ?? "USD"}
        </span>
      )}
    </div>
  );
}
