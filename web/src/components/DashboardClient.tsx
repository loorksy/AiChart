"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  LineChart,
  Power,
  Send,
  Shield,
} from "lucide-react";
import type { AdminLimits, PublicUser, TradingSettings } from "@/lib/types";
import { SurfaceCard } from "@/components/ui/shell";
import { displayNameFromEmail } from "@/lib/displayName";
import { useMe } from "@/hooks/useMe";

const STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار الموافقة",
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
  const { data: me } = useMe();
  const [killOn, setKillOn] = useState(settings.kill_switch === 1);
  const [killBusy, setKillBusy] = useState(false);

  const used = me?.quota.used ?? 0;
  const remaining = me?.quota.remaining ?? Math.max(0, limits.claude_quota - used);
  const limit = me?.quota.limit ?? limits.claude_quota;
  const displayName = displayNameFromEmail(user.email);
  const tgLinked = Boolean(settings.telegram_chat_id);

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

  return (
    <main className="page-shell space-y-4">
      <div>
        <h1 className="page-title">حسابي</h1>
        <p className="page-subtitle">لوحة الحساب والرصيد</p>
      </div>

      <SurfaceCard className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-serif text-lg font-bold text-primary">
          {displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-lg font-bold">{displayName}</p>
          <p className="truncate text-sm text-muted-foreground" dir="ltr">
            {user.email}
          </p>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 ${
                user.status === "active"
                  ? "bg-secondary text-foreground"
                  : user.status === "pending"
                    ? "bg-accent text-accent-foreground"
                    : "bg-destructive/10 text-destructive"
              }`}
            >
              {STATUS_LABEL[user.status]}
            </span>
            {tgLinked && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                تليجرام مرتبط
              </span>
            )}
          </div>
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <SurfaceCard padding="sm" className="text-center">
          <p className="text-[10px] text-muted-foreground sm:text-xs">متبقّي</p>
          <p className="font-serif text-xl font-bold sm:text-2xl">{remaining}</p>
        </SurfaceCard>
        <SurfaceCard padding="sm" className="text-center">
          <p className="text-[10px] text-muted-foreground sm:text-xs">مُستهلك</p>
          <p className="font-serif text-xl font-bold sm:text-2xl">{used}</p>
        </SurfaceCard>
        <SurfaceCard padding="sm" className="text-center">
          <p className="text-[10px] text-muted-foreground sm:text-xs">الإجمالي</p>
          <p className="font-serif text-xl font-bold sm:text-2xl">{limit}</p>
        </SurfaceCard>
      </div>

      <SurfaceCard className="space-y-3">
        <div className="flex items-start gap-3">
          <CreditCard className="mt-0.5 h-5 w-5 text-accent-gold" />
          <div>
            <h2 className="font-semibold">الاشتراك</h2>
            <p className="text-sm text-muted-foreground">
              {user.status === "active"
                ? "حسابك مفعّل. تواصل مع الإدارة لتوسيع الرصيد."
                : "حسابك بانتظار موافقة الإدارة."}
            </p>
          </div>
        </div>
        <Link href="/plan" className="btn btn-primary w-full">
          <Send className="h-4 w-4" />
          تواصل للاشتراك
        </Link>
      </SurfaceCard>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/settings" className="block">
          <SurfaceCard className="flex items-center gap-3 transition hover:bg-secondary/50">
            <ArrowLeftRight className="h-5 w-5 text-accent-gold" />
            <div>
              <p className="font-medium">ربط Binance</p>
              <p className="text-xs text-muted-foreground">
                {hasBinance ? "مرتبط" : "غير مربوط"}
              </p>
            </div>
          </SurfaceCard>
        </Link>

        <Link href="/trades" className="block">
          <SurfaceCard className="flex items-center gap-3 transition hover:bg-secondary/50">
            <BarChart3 className="h-5 w-5 text-accent-gold" />
            <div>
              <p className="font-medium">الصفقات</p>
              <p className="text-xs text-muted-foreground">سجل التنفيذ</p>
            </div>
          </SurfaceCard>
        </Link>

        <Link href="/market" className="block">
          <SurfaceCard className="flex items-center gap-3 transition hover:bg-secondary/50">
            <LineChart className="h-5 w-5 text-accent-gold" />
            <div>
              <p className="font-medium">الشارت</p>
              <p className="text-xs text-muted-foreground">تحليل فني مباشر</p>
            </div>
          </SurfaceCard>
        </Link>

        <SurfaceCard
          className={`flex items-center justify-between gap-3 ${
            killOn ? "border-destructive/30" : ""
          }`}
        >
          <div className="flex items-center gap-3">
            <Power
              className={`h-5 w-5 ${killOn ? "text-destructive" : "text-accent-gold"}`}
            />
            <div>
              <p className="font-medium">الإيقاف الطارئ</p>
              <p className="text-xs text-muted-foreground">
                {killOn ? "التداول موقوف" : "التداول مفعّل"}
              </p>
            </div>
          </div>
          <button
            onClick={() => void toggleKill()}
            disabled={killBusy}
            className={`btn text-xs ${killOn ? "btn-secondary" : "btn-danger"}`}
          >
            {killBusy ? "…" : killOn ? "تفعيل" : "إيقاف"}
          </button>
        </SurfaceCard>
      </div>

      {limits.can_execute === 0 && (
        <SurfaceCard className="flex items-start gap-3 border-accent-gold/30">
          <Shield className="mt-0.5 h-5 w-5 text-accent-gold" />
          <p className="text-sm text-muted-foreground">
            التنفيذ التلقائي غير مفعّل. تواصل مع الإدارة لتفعيله.
          </p>
        </SurfaceCard>
      )}
    </main>
  );
}
