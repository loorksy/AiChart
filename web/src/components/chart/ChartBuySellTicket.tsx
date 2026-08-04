"use client";

/**
 * TradingView-style buy/sell controls for a linked cloud account.
 *
 * Non-negotiable: every submit goes through request_approval (pending intent)
 * — never a direct broker execution call. The operator still has to confirm
 * before money moves. See mcp cardButtons.test.ts for the same split on cards.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/** The only endpoint this surface may call. Mirrored by the unit test. */
export const CHART_TRADE_ALLOWED_ENDPOINT = "/api/trades/request-approval";

export function ChartBuySellTicket({
  symbol,
  connected,
  className,
}: {
  symbol: string;
  /** Cloud MetaTrader account linked — hide entirely otherwise. */
  connected: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [side, setSide] = useState<"buy" | "sell" | null>(null);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!connected) return null;

  const submit = async () => {
    if (!side) return;
    const sl = Number(stopLoss);
    if (!Number.isFinite(sl) || sl <= 0) {
      setMessage(t("chart.trade.sl_required"));
      return;
    }
    const tpRaw = takeProfit.trim();
    const tp = tpRaw ? Number(tpRaw) : null;
    if (tpRaw && (!Number.isFinite(tp) || (tp as number) <= 0)) {
      setMessage(t("chart.trade.tp_invalid"));
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      // Approval only — placing the order requires a separate human confirm.
      const res = await fetch(CHART_TRADE_ALLOWED_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          stop_loss: sl,
          take_profit: tp,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        intentId?: number;
      };
      if (!res.ok) {
        setMessage(data.error ?? t("chart.trade.failed"));
        return;
      }
      setMessage(t("chart.trade.pending"));
      setSide(null);
      setStopLoss("");
      setTakeProfit("");
    } catch {
      setMessage(t("chart.trade.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="chart-buy-sell"
      className={cn(
        "pointer-events-auto absolute bottom-12 end-2 z-30 w-[min(100%,220px)] rounded-lg border border-border/60 bg-background/95 p-2 shadow-md backdrop-blur-md",
        className,
      )}
    >
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          data-testid="chart-buy"
          data-active={side === "buy" ? "true" : "false"}
          onClick={() => setSide("buy")}
          className={cn(
            "rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
            side === "buy"
              ? "bg-buy text-white"
              : "bg-buy/15 text-buy hover:bg-buy/25",
          )}
        >
          {t("chart.trade.buy")}
        </button>
        <button
          type="button"
          data-testid="chart-sell"
          data-active={side === "sell" ? "true" : "false"}
          onClick={() => setSide("sell")}
          className={cn(
            "rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
            side === "sell"
              ? "bg-sell text-white"
              : "bg-sell/15 text-sell hover:bg-sell/25",
          )}
        >
          {t("chart.trade.sell")}
        </button>
      </div>

      {side && (
        <div className="mt-2 space-y-1.5" dir="ltr">
          <label className="block text-[10px] text-muted-foreground">
            {t("chart.trade.stop_loss")}
            <input
              data-testid="chart-sl"
              inputMode="decimal"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-xs tabular-nums outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <label className="block text-[10px] text-muted-foreground">
            {t("chart.trade.take_profit")}
            <input
              data-testid="chart-tp"
              inputMode="decimal"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-xs tabular-nums outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <button
            type="button"
            data-testid="chart-request-approval"
            disabled={busy}
            onClick={() => void submit()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-2 py-1.5 text-xs font-semibold text-background disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {t("chart.trade.request_approval")}
          </button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t("chart.trade.approval_note")}
          </p>
        </div>
      )}

      {message && (
        <p className="mt-1.5 text-[10px] text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
