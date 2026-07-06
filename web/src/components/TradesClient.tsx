"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Trade, TradeIntent } from "@/lib/types";
import { AgentActivityFeed } from "@/components/ui/agent-activity-feed";
import { useAgentActivities } from "@/hooks/useAgentActivities";
import { MessageLoading } from "@/components/ui/message-loading";
import { PageLayout, SectionTitle } from "@/components/ui/shell";
import { consumeSse } from "@/lib/sse";

const STATUS_AR: Record<string, string> = {
  pending: "بانتظار موافقتك",
  approved: "موافق",
  rejected: "مرفوض",
  executed: "نُفّذت",
  failed: "فشل",
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
}: {
  initialIntents: TradeIntent[];
  initialTrades: Trade[];
}) {
  const router = useRouter();
  const [intents, setIntents] = useState(initialIntents);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [executingId, setExecutingId] = useState<number | null>(null);
  const { activities, reset: resetActivities, upsert: upsertActivity } =
    useAgentActivities();

  const [trades, setTrades] = useState(initialTrades);
  const [closingId, setClosingId] = useState<number | null>(null);

  const pending = intents.filter((i) => i.status === "pending");
  const history = intents.filter((i) => i.status !== "pending");
  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status !== "open");

  async function closeTrade(id: number) {
    setClosingId(id);
    try {
      const res = await fetch(`/api/trades/${id}/close`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.reason ?? data.error ?? "تعذّر إغلاق الصفقة.");
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
          alert(
            `لم تُنفّذ: ${(data as { reason?: string; error?: string }).reason ?? (data as { error?: string }).error ?? "سبب غير معروف"}`,
          );
        } else {
          const data = await consumeSse<{ ok: boolean; reason?: string }>(res, {
            onActivity: upsertActivity,
            onError: (msg) => alert(msg),
          });
          if (data && !data.ok) {
            alert(`لم تُنفّذ: ${data.reason ?? "سبب غير معروف"}`);
          }
        }
      } else {
        const data = await res.json();
        if (!res.ok) {
          alert(data.error ?? "تعذّر رفض الطلب.");
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

  return (
    <PageLayout title="الصفقات" subtitle="موافقة، تنفيذ، وإغلاق الصفقات">
      <section className="mb-8">
        <SectionTitle>بانتظار موافقتك ({pending.length})</SectionTitle>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد صفقات بانتظار موافقتك.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pending.map((i) => (
              <div key={i.id} className="surface-card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold text-foreground" dir="ltr">
                    {i.symbol}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-bold",
                      i.side === "buy"
                        ? "bg-sidebar-accent text-primary"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {i.side === "buy" ? "شراء" : "بيع"} · ثقة {i.confidence}%
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  الحجم: <span dir="ltr">{i.notional.toFixed(2)} USD</span>
                </p>
                {i.rationale && (
                  <p className="mt-1 text-xs text-muted-foreground">{i.rationale}</p>
                )}
                {executingId === i.id && activities.length > 0 && (
                  <div className="mt-3">
                    <AgentActivityFeed
                      activities={activities}
                      title="تنفيذ الصفقة"
                    />
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn btn-primary flex-1 py-1.5 text-sm"
                    disabled={busyId === i.id}
                    onClick={() => act(i.id, "approve")}
                  >
                    {busyId === i.id ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <MessageLoading />
                      </span>
                    ) : (
                      "موافقة وتنفيذ"
                    )}
                  </button>
                  <button
                    className="btn btn-danger flex-1 py-1.5 text-sm"
                    disabled={busyId === i.id}
                    onClick={() => act(i.id, "reject")}
                  >
                    رفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {openTrades.length > 0 && (
        <section className="mb-8">
          <SectionTitle>صفقات مفتوحة ({openTrades.length})</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {openTrades.map((t) => (
              <div key={t.id} className="surface-card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold text-foreground" dir="ltr">
                    {t.symbol}
                  </span>
                  <span className="text-xs text-chart-1">مفتوحة</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.side === "buy" ? "شراء" : "بيع"} ·{" "}
                  <span dir="ltr">{t.qty}</span> @{" "}
                  <span dir="ltr">{t.avg_price}</span>
                </p>
                <button
                  className="btn btn-secondary mt-3 w-full py-1.5 text-sm"
                  disabled={closingId === t.id}
                  onClick={() => void closeTrade(t.id)}
                >
                  {closingId === t.id ? "جاري الإغلاق…" : "إغلاق الصفقة"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <SectionTitle>سجل الصفقات</SectionTitle>
        {closedTrades.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد صفقات مغلقة بعد.</p>
        ) : (
          <div className="surface-card overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="p-3">الرمز</th>
                  <th className="p-3">الاتجاه</th>
                  <th className="p-3">الكمية</th>
                  <th className="p-3">السعر</th>
                  <th className="p-3">PnL</th>
                  <th className="p-3">البيئة</th>
                  <th className="p-3">الوقت</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((t) => (
                  <tr key={t.id} className="border-b border-border/50">
                    <td className="p-3" dir="ltr">{t.symbol}</td>
                    <td className="p-3">{t.side === "buy" ? "شراء" : "بيع"}</td>
                    <td className="p-3 font-mono" dir="ltr">{t.qty}</td>
                    <td className="p-3 font-mono" dir="ltr">{t.avg_price}</td>
                    <td
                      className={cn(
                        "p-3 font-mono",
                        t.pnl >= 0 ? "text-primary" : "text-destructive",
                      )}
                      dir="ltr"
                    >
                      {t.pnl >= 0 ? "+" : ""}
                      {t.pnl.toFixed(2)}
                    </td>
                    <td className="p-3">{t.env === "testnet" ? "تجريبي" : "حقيقي"}</td>
                    <td className="p-3 text-xs text-muted-foreground" dir="ltr">
                      {(t.closed_at ?? t.created_at).slice(0, 16)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <SectionTitle>سجلّ الطلبات</SectionTitle>
          <div className="space-y-2">
            {history.map((i) => (
              <div
                key={i.id}
                className="surface-card flex items-center justify-between p-3 text-sm"
              >
                <span dir="ltr">
                  {i.symbol} · {i.side === "buy" ? "شراء" : "بيع"}
                </span>
                <span className={STATUS_CLASS[i.status] ?? "text-foreground"}>
                  {STATUS_AR[i.status]}
                  {i.reason ? ` — ${i.reason}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </PageLayout>
  );
}
