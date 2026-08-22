"use client";

/**
 * On-demand trade monitoring: open positions, closed results in money.
 * Loads only when the user asks (the refresh press), never streams, and
 * renders nothing preachy — numbers, signed, done.
 */
import { useCallback, useState } from "react";
import { ListChecks, RefreshCw } from "lucide-react";
import { Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

interface TradesView {
  linked: boolean;
  open: Array<{
    position_id: string;
    symbol: string;
    type: string;
    volume: number | null;
    open_price: number | null;
    profit: number | null;
  }>;
  closed: Array<{
    position_id: string | null;
    symbol: string;
    volume: number | null;
    close_price: number | null;
    net_profit: number | null;
  }>;
  closed_net_total: number;
}

function money(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(2);
}

export function ExecutionTradesCard() {
  const { t, dir } = useLocale();
  const [view, setView] = useState<TradesView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/execution/trades", { cache: "no-store" });
      if (!res.ok) {
        setView({ linked: false, open: [], closed: [], closed_net_total: 0 });
        return;
      }
      setView((await res.json()) as TradesView);
    } catch {
      setView({ linked: false, open: [], closed: [], closed_net_total: 0 });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Surface dir={dir} className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListChecks aria-hidden className="h-4 w-4" />
          {t("exec.trades.title")}
        </h3>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw
            aria-hidden
            className={cn("h-3.5 w-3.5", busy && "animate-spin motion-reduce:animate-none")}
          />
          {t("exec.trades.refresh")}
        </Button>
      </div>

      {view && !view.linked && (
        <p className="text-xs text-muted-foreground">{t("exec.trades.not_linked")}</p>
      )}

      {view?.linked && (
        <div className="space-y-3 text-xs">
          <div>
            <p className="mb-1 font-medium text-muted-foreground">{t("exec.trades.open")}</p>
            {view.open.length === 0 ? (
              <p className="text-muted-foreground">{t("exec.trades.empty")}</p>
            ) : (
              view.open.map((p) => (
                <div
                  key={p.position_id}
                  className="flex items-center justify-between border-t border-border/40 py-1"
                >
                  <span className="text-foreground">
                    {p.symbol} · {p.type.includes("BUY") ? t("decision.buy") : t("decision.sell")} ·{" "}
                    {p.volume ?? "—"}
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      (p.profit ?? 0) >= 0 ? "text-buy" : "text-sell",
                    )}
                  >
                    {money(p.profit)}
                  </span>
                </div>
              ))
            )}
          </div>
          <div>
            <p className="mb-1 font-medium text-muted-foreground">{t("exec.trades.closed")}</p>
            {view.closed.length === 0 ? (
              <p className="text-muted-foreground">{t("exec.trades.empty")}</p>
            ) : (
              <>
                {view.closed.map((c, index) => (
                  <div
                    key={`${c.position_id ?? index}`}
                    className="flex items-center justify-between border-t border-border/40 py-1"
                  >
                    <span className="text-foreground">
                      {c.symbol} · {c.volume ?? "—"}
                    </span>
                    <span
                      className={cn(
                        "font-semibold",
                        (c.net_profit ?? 0) >= 0 ? "text-buy" : "text-sell",
                      )}
                    >
                      {money(c.net_profit)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border py-1 font-semibold text-foreground">
                  <span>{t("exec.trades.net")}</span>
                  <span className={view.closed_net_total >= 0 ? "text-buy" : "text-sell"}>
                    {money(view.closed_net_total)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Surface>
  );
}
