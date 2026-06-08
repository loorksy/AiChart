"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AdminLimits, PublicUser, TradingSettings } from "@/lib/types";

interface BinanceStatus {
  connected: boolean;
  env?: string;
  canTrade?: boolean;
  canWithdraw?: boolean;
  reachable?: boolean;
  error?: string;
  balances?: { asset: string; free: string; locked: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار موافقة الإدارة",
  active: "مفعّل",
  suspended: "موقوف",
};

export default function DashboardClient({
  user,
  settings,
  limits,
  hasBinance,
}: {
  user: PublicUser;
  settings: TradingSettings;
  limits: AdminLimits;
  hasBinance: boolean;
}) {
  const [status, setStatus] = useState<BinanceStatus | null>(null);
  const [loading, setLoading] = useState(hasBinance);
  const [killOn, setKillOn] = useState(settings.kill_switch === 1);
  const [killBusy, setKillBusy] = useState(false);

  async function toggleKill() {
    const next = !killOn;
    setKillBusy(true);
    try {
      const res = await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      const data = await res.json();
      if (res.ok) setKillOn(data.kill_switch === 1);
    } finally {
      setKillBusy(false);
    }
  }

  useEffect(() => {
    if (!hasBinance) return;
    fetch("/api/binance/status")
      .then((r) => r.json())
      .then(setStatus)
      .finally(() => setLoading(false));
  }, [hasBinance]);

  const modeLabel = settings.mode === "auto" ? "تنفيذ تلقائي" : "توصيات فقط";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">مرحباً 👋</h1>
          <p className="text-sm text-[var(--muted)]" dir="ltr">
            {user.email}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            user.status === "active"
              ? "bg-[var(--accent)]/15 text-[var(--accent)]"
              : user.status === "pending"
                ? "bg-[var(--warning)]/15 text-[var(--warning)]"
                : "bg-[var(--danger)]/15 text-[var(--danger)]"
          }`}
        >
          {STATUS_LABEL[user.status]}
        </span>
      </div>

      <div
        className={`card mb-6 flex flex-wrap items-center justify-between gap-3 p-5 ${
          killOn ? "border-[var(--danger)]" : ""
        }`}
      >
        <div>
          <h2 className="font-bold">الإيقاف الطارئ (Kill Switch)</h2>
          <p className="text-sm text-[var(--muted)]">
            {killOn
              ? "التداول موقوف بالكامل في حسابك. لن يفتح الوكيل أي صفقة."
              : "التداول مفعّل. يمكنك إيقاف كل شيء فوراً عند الحاجة."}
          </p>
        </div>
        <button
          onClick={toggleKill}
          disabled={killBusy}
          className={`btn ${killOn ? "btn-secondary" : "btn-danger"}`}
        >
          {killBusy ? "…" : killOn ? "إلغاء الإيقاف" : "إيقاف طارئ الآن"}
        </button>
      </div>

      {user.status === "pending" && (
        <div className="card mb-6 border-[var(--warning)]/40 p-5">
          <p className="text-sm">
            حسابك قيد المراجعة. بإمكانك ربط مفاتيح Binance (Testnet) الآن، لكن
            التداول الفعلي يبدأ بعد موافقة الإدارة.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <p className="text-sm text-[var(--muted)]">الوضع الحالي</p>
          <p className="mt-1 text-xl font-bold">{modeLabel}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {settings.experience === "beginner" ? "مستوى مبتدئ" : "مستوى خبير"} ·
            أسلوب{" "}
            {settings.style === "conservative"
              ? "محافظ"
              : settings.style === "balanced"
                ? "متوازن"
                : "نشِط"}
          </p>
        </div>

        <div className="card p-5">
          <p className="text-sm text-[var(--muted)]">صلاحية التنفيذ</p>
          <p
            className={`mt-1 text-xl font-bold ${limits.can_execute ? "text-[var(--accent)]" : "text-[var(--warning)]"}`}
          >
            {limits.can_execute ? "مفعّلة" : "غير مفعّلة"}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {limits.can_execute
              ? `سقف رأس المال: ${limits.max_capital_cap || "غير محدّد"}`
              : "تتطلب موافقة الإدارة"}
          </p>
        </div>

        <div className="card p-5">
          <p className="text-sm text-[var(--muted)]">حدّ الخسارة اليومي</p>
          <p className="mt-1 text-xl font-bold text-[var(--danger)]">
            −{settings.daily_loss_limit_pct}%
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            هدف الربح اليومي: +{settings.daily_profit_target_pct}%
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">اتصال Binance</h2>
            <Link href="/settings" className="text-sm text-[var(--accent-2)]">
              إدارة
            </Link>
          </div>
          {!hasBinance && (
            <p className="text-sm text-[var(--muted)]">
              لم تربط حساب Binance بعد.{" "}
              <Link href="/settings" className="text-[var(--accent-2)]">
                اربطه الآن
              </Link>
              .
            </p>
          )}
          {hasBinance && loading && (
            <p className="text-sm text-[var(--muted)]">جارٍ فحص الاتصال…</p>
          )}
          {status?.connected && status.reachable !== false && (
            <div className="space-y-2 text-sm">
              <p>
                البيئة:{" "}
                <span className="font-semibold">
                  {status.env === "testnet" ? "تجريبية (Testnet)" : "حقيقية"}
                </span>
              </p>
              <p>
                التداول:{" "}
                <span className="text-[var(--accent)]">
                  {status.canTrade ? "مسموح" : "غير مسموح"}
                </span>
              </p>
              {status.canWithdraw && (
                <p className="text-[var(--warning)]">
                  ⚠ صلاحية السحب مفعّلة — يُنصح بتعطيلها.
                </p>
              )}
              <div className="mt-2 border-t border-[var(--border)] pt-2">
                <p className="mb-1 text-[var(--muted)]">الأرصدة:</p>
                {status.balances && status.balances.length > 0 ? (
                  <ul className="space-y-1" dir="ltr">
                    {status.balances.slice(0, 6).map((b) => (
                      <li key={b.asset} className="flex justify-between">
                        <span>{b.asset}</span>
                        <span className="font-mono">{b.free}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[var(--muted)]">لا توجد أرصدة.</p>
                )}
              </div>
            </div>
          )}
          {status?.reachable === false && (
            <p className="text-sm text-[var(--danger)]">
              تعذّر الاتصال: {status.error}
            </p>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-bold">الدردشة مع الوكيل</h2>
          <p className="text-sm text-[var(--muted)]">
            تحدّث مع الخبير، اطلب تحليل أي عملة مسموح بها، وتلقَّ توصياته
            (شراء/بيع/انتظار) مع وقف الخسارة والهدف.
          </p>
          <Link href="/chat" className="btn btn-primary mt-4">
            ابدأ الدردشة
          </Link>
        </div>
      </div>
    </main>
  );
}
