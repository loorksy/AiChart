"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Trade, TradeIntent } from "@/lib/types";
import { AgentActivityFeed } from "@/components/ui/agent-activity-feed";
import { useAgentActivities } from "@/hooks/useAgentActivities";
import { MessageLoading } from "@/components/ui/message-loading";
import { PageLayout, SectionTitle, SurfaceCard } from "@/components/ui/shell";
import { consumeSse } from "@/lib/sse";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

const STATUS_KEY: Record<string, TranslationKey> = {
  pending: "trades.status.pending",
  approved: "trades.status.approved",
  rejected: "trades.status.rejected",
  executed: "trades.status.executed",
  failed: "trades.status.failed",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "text-chart-1",
  approved: "text-chart-2",
  rejected: "text-muted-foreground",
  executed: "text-primary",
  failed: "text-destructive",
};

export default function TradesClient({
  initialIntents,
  initialTrades,
  embedded = false,
}: {
  initialIntents: TradeIntent[];
  initialTrades: Trade[];
  /** Render as a section inside another page (no <main>, no page title). */
  embedded?: boolean;
}) {
  const router = useRouter();
  const { t, dir } = useLocale();
  const [intents, setIntents] = useState(initialIntents);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [executingId, setExecutingId] = useState<number | null>(null);
  const { activities, reset: resetActivities, upsert: upsertActivity } =
    useAgentActivities();

  const [trades, setTrades] = useState(initialTrades);
  const [closingId, setClosingId] = useState<number | null>(null);

  const pending = intents.filter((i) => i.status === "pending");
  const history = intents.filter((i) => i.status !== "pending");
  const openTrades = trades.filter((trade) => trade.status === "open");
  const closedTrades = trades.filter((trade) => trade.status !== "open");

  async function closeTrade(id: number) {
    setClosingId(id);
    try {
      const res = await fetch(`/api/trades/${id}/close`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.reason ?? data.error ?? t("trades.err.close"));
        return;
      }
      const r = await fetch("/api/trades");
      const refreshed = await r.json();
      setTrades(refreshed.trades);
      router.refresh();
    } finally {
      setClosingId(null);
    }
  }

  async function act(id: number, action: "approve" | "reject") {
    setBusyId(id);
    const isApprove = action === "approve";
    if (isApprove) {
      setExecutingId(id);
      resetActivities();
    }
    try {
      const res = await fetch(`/api/trades/intents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, stream: isApprove }),
      });

      if (isApprove) {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const reason =
            (data as { reason?: string; error?: string }).reason ??
            (data as { error?: string }).error ??
            t("trades.err.unknown");
          alert(t("trades.err.execute", { reason }));
        } else {
          const data = await consumeSse<{ ok: boolean; reason?: string }>(res, {
            onActivity: upsertActivity,
            onError: (msg) => alert(msg),
          });
          if (data && !data.ok) {
            alert(
              t("trades.err.execute", {
                reason: data.reason ?? t("trades.err.unknown"),
              }),
            );
          }
        }
      } else {
        const data = await res.json();
        if (!res.ok) {
          alert(data.error ?? t("trades.err.reject"));
        }
      }

      const r = await fetch("/api/trades/intents");
      const refreshed = await r.json();
      setIntents(refreshed.intents);
      router.refresh();
    } finally {
      setBusyId(null);
      setExecutingId(null);
      resetActivities();
    }
  }

  const sideLabel = (side: string) =>
    side === "buy" ? t("trades.buy") : t("trades.sell");

  const body = (
    <>
      <section className="space-y-3">
        <SectionTitle>
          {t("trades.pending", { count: String(pending.length) })}
        </SectionTitle>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("trades.pending_empty")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pending.map((intent) => (
              <SurfaceCard key={intent.id} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-base font-semibold tracking-tight" dir="ltr">
                    {intent.symbol}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold",
                      intent.side === "buy"
                        ? "bg-primary/10 text-primary"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {sideLabel(intent.side)} ·{" "}
                    {t("trades.confidence", { pct: String(intent.confidence) })}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("trades.size")}:{" "}
                  <span dir="ltr">{intent.notional.toFixed(2)} USD</span>
                </p>
                {intent.rationale && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {intent.rationale}
                  </p>
                )}
                {executingId === intent.id && activities.length > 0 && (
                  <AgentActivityFeed
                    activities={activities}
                    title={t("trades.executing")}
                  />
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    className="btn btn-primary flex-1 py-2 text-sm"
                    disabled={busyId === intent.id}
                    onClick={() => void act(intent.id, "approve")}
                  >
                    {busyId === intent.id && executingId === intent.id ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <MessageLoading />
                      </span>
                    ) : (
                      t("trades.approve_execute")
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger flex-1 py-2 text-sm"
                    disabled={busyId === intent.id}
                    onClick={() => void act(intent.id, "reject")}
                  >
                    {t("trades.reject")}
                  </button>
                </div>
              </SurfaceCard>
            ))}
          </div>
        )}
      </section>

      {openTrades.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>
            {t("trades.open", { count: String(openTrades.length) })}
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {openTrades.map((trade) => (
              <SurfaceCard key={trade.id} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold" dir="ltr">
                    {trade.symbol}
                  </span>
                  <span className="text-xs font-medium text-chart-1">
                    {t("trades.status_open")}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {sideLabel(trade.side)} · <span dir="ltr">{trade.qty}</span> @{" "}
                  <span dir="ltr">{trade.avg_price}</span>
                </p>
                <button
                  type="button"
                  className="btn btn-secondary w-full py-2 text-sm"
                  disabled={closingId === trade.id}
                  onClick={() => void closeTrade(trade.id)}
                >
                  {closingId === trade.id ? t("trades.closing") : t("trades.close")}
                </button>
              </SurfaceCard>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>{t("trades.history")}</SectionTitle>
        {closedTrades.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("trades.history_empty")}</p>
        ) : (
          <SurfaceCard padding="none" className="overflow-x-auto">
            <table className="w-full text-sm" dir={dir}>
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">{t("trades.col.symbol")}</th>
                  <th className="p-3 font-medium">{t("trades.col.side")}</th>
                  <th className="p-3 font-medium">{t("trades.col.qty")}</th>
                  <th className="p-3 font-medium">{t("trades.col.price")}</th>
                  <th className="p-3 font-medium">{t("trades.col.pnl")}</th>
                  <th className="p-3 font-medium">{t("trades.col.env")}</th>
                  <th className="p-3 font-medium">{t("trades.col.time")}</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border/60 last:border-0">
                    <td className="p-3" dir="ltr">
                      {trade.symbol}
                    </td>
                    <td className="p-3">{sideLabel(trade.side)}</td>
                    <td className="p-3 font-mono" dir="ltr">
                      {trade.qty}
                    </td>
                    <td className="p-3 font-mono" dir="ltr">
                      {trade.avg_price}
                    </td>
                    <td
                      className={cn(
                        "p-3 font-mono",
                        trade.pnl >= 0 ? "text-primary" : "text-destructive",
                      )}
                      dir="ltr"
                    >
                      {trade.pnl >= 0 ? "+" : ""}
                      {trade.pnl.toFixed(2)}
                    </td>
                    <td className="p-3">
                      {trade.env === "testnet"
                        ? t("trades.env.testnet")
                        : t("trades.env.live")}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground" dir="ltr">
                      {(trade.closed_at ?? trade.created_at).slice(0, 16)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SurfaceCard>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>{t("trades.intents_history")}</SectionTitle>
          <div className="space-y-2">
            {history.map((intent) => (
              <SurfaceCard
                key={intent.id}
                padding="sm"
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span dir="ltr">
                  {intent.symbol} · {sideLabel(intent.side)}
                </span>
                <span className={STATUS_CLASS[intent.status] ?? "text-foreground"}>
                  {t(STATUS_KEY[intent.status] ?? "trades.status.failed")}
                  {intent.reason ? ` — ${intent.reason}` : ""}
                </span>
              </SurfaceCard>
            ))}
          </div>
        </section>
      )}
    </>
  );

  if (embedded) {
    return (
      <section id="trades" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t("trades.title")}</h2>
        {body}
      </section>
    );
  }

  return (
    <PageLayout title={t("trades.title")} subtitle={t("trades.subtitle")}>
      {body}
    </PageLayout>
  );
}
