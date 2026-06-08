"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Trade, TradeIntent } from "@/lib/types";

const STATUS_AR: Record<string, string> = {
  pending: "بانتظار موافقتك",
  approved: "موافق",
  rejected: "مرفوض",
  executed: "نُفّذت",
  failed: "فشل",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--warning)",
  approved: "var(--accent-2)",
  rejected: "var(--muted)",
  executed: "var(--accent)",
  failed: "var(--danger)",
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

  const pending = intents.filter((i) => i.status === "pending");
  const history = intents.filter((i) => i.status !== "pending");

  async function act(id: number, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/trades/intents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      const r = await fetch("/api/trades/intents");
      const refreshed = await r.json();
      setIntents(refreshed.intents);
      if (action === "approve" && !data.ok) {
        alert(`لم تُنفّذ: ${data.reason ?? "سبب غير معروف"}`);
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <h1 className="mb-6 text-2xl font-bold">الصفقات</h1>

      <section className="mb-8">
        <h2 className="mb-3 font-bold">بانتظار موافقتك ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">لا توجد صفقات بانتظار موافقتك.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pending.map((i) => (
              <div key={i.id} className="card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold" dir="ltr">
                    {i.symbol}
                  </span>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-bold"
                    style={{
                      background:
                        i.side === "buy"
                          ? "var(--accent)22"
                          : "var(--danger)22",
                      color: i.side === "buy" ? "var(--accent)" : "var(--danger)",
                    }}
                  >
                    {i.side === "buy" ? "شراء" : "بيع"} · ثقة {i.confidence}%
                  </span>
                </div>
                <p className="text-sm text-[var(--muted)]">
                  الحجم: <span dir="ltr">{i.notional.toFixed(2)} USDT</span>
                </p>
                {i.rationale && (
                  <p className="mt-1 text-xs text-[var(--muted)]">{i.rationale}</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn btn-primary flex-1 py-1.5 text-sm"
                    disabled={busyId === i.id}
                    onClick={() => act(i.id, "approve")}
                  >
                    {busyId === i.id ? "…" : "موافقة وتنفيذ"}
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

      <section className="mb-8">
        <h2 className="mb-3 font-bold">الصفقات المنفّذة</h2>
        {initialTrades.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">لا توجد صفقات منفّذة بعد.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th className="p-3">الرمز</th>
                  <th className="p-3">الاتجاه</th>
                  <th className="p-3">الكمية</th>
                  <th className="p-3">السعر</th>
                  <th className="p-3">البيئة</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">الوقت</th>
                </tr>
              </thead>
              <tbody>
                {initialTrades.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border)]/50">
                    <td className="p-3" dir="ltr">{t.symbol}</td>
                    <td className="p-3">{t.side === "buy" ? "شراء" : "بيع"}</td>
                    <td className="p-3 font-mono" dir="ltr">{t.qty}</td>
                    <td className="p-3 font-mono" dir="ltr">{t.avg_price}</td>
                    <td className="p-3">{t.env === "testnet" ? "تجريبي" : "حقيقي"}</td>
                    <td className="p-3">{t.status === "open" ? "مفتوحة" : "مغلقة"}</td>
                    <td className="p-3 text-xs text-[var(--muted)]" dir="ltr">
                      {t.created_at.slice(0, 16)}
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
          <h2 className="mb-3 font-bold">سجلّ الطلبات</h2>
          <div className="space-y-2">
            {history.map((i) => (
              <div
                key={i.id}
                className="card flex items-center justify-between p-3 text-sm"
              >
                <span dir="ltr">
                  {i.symbol} · {i.side === "buy" ? "شراء" : "بيع"}
                </span>
                <span style={{ color: STATUS_COLOR[i.status] }}>
                  {STATUS_AR[i.status]}
                  {i.reason ? ` — ${i.reason}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
