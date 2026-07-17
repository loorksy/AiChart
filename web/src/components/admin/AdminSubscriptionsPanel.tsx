"use client";

import { useCallback, useState } from "react";
import { AICHART_PLAN } from "@/lib/subscription/plan";

type SubRow = {
  user_id: number;
  email: string;
  role: string;
  status: string;
  plan_status: string;
  trial_interactions_used: number;
  subscription_expires_at: string | null;
  note: string | null;
};

export function AdminSubscriptionsPanel() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SubRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const search = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/subscriptions?q=${encodeURIComponent(q.trim())}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setRows(data.users ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }, [q]);

  async function mutate(
    userId: number,
    action: "activate" | "suspend" | "restore_trial",
    expiresAt?: string,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/subscriptions/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expiresAt: expiresAt || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setMessage("تم التحديث");
      await search();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="admin-subscriptions-panel">
      <div>
        <h3 className="text-base font-semibold">إدارة الاشتراكات</h3>
        <p className="text-sm text-muted-foreground">
          خطة واحدة: {AICHART_PLAN.titleAr} — {AICHART_PLAN.promotionalPriceUsd}$
          (بدلاً من {AICHART_PLAN.regularPriceUsd}$) · تفعيل يدوي بعد الدفع عبر Telegram
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="بحث بالبريد…"
          className="min-h-10 min-w-[16rem] flex-1 rounded-lg border border-border bg-background px-3 text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void search()}
          className="min-h-10 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
        >
          بحث
        </button>
      </div>

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-start text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">المستخدم</th>
              <th className="p-2 font-medium">الحالة</th>
              <th className="p-2 font-medium">التجربة</th>
              <th className="p-2 font-medium">الانتهاء</th>
              <th className="p-2 font-medium">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-t border-border">
                <td className="p-2">
                  <div className="font-medium">{r.email}</div>
                  <div className="text-[11px] text-muted-foreground">#{r.user_id}</div>
                </td>
                <td className="p-2">{r.plan_status}</td>
                <td className="p-2 tabular-nums">
                  {r.trial_interactions_used}/{AICHART_PLAN.trialInteractions}
                </td>
                <td className="p-2 text-xs">
                  {r.subscription_expires_at
                    ? new Date(r.subscription_expires_at).toLocaleDateString()
                    : "—"}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={busy || r.role === "admin"}
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                      onClick={() => void mutate(r.user_id, "activate")}
                    >
                      تفعيل
                    </button>
                    <button
                      type="button"
                      disabled={busy || r.role === "admin"}
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                      onClick={() => void mutate(r.user_id, "suspend")}
                    >
                      إيقاف
                    </button>
                    <button
                      type="button"
                      disabled={busy || r.role === "admin"}
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                      onClick={() => void mutate(r.user_id, "restore_trial")}
                    >
                      تجربة
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">
                  ابحث عن مستخدم لإدارة اشتراكه
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
