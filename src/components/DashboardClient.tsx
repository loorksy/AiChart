"use client";

import { FadeIn } from "@/components/ui/fade-in";
import Link from "next/link";
import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  FileText,
  LineChart,
  Send,
  Shield,
} from "lucide-react";
import type { AdminLimits, PublicUser, Trade, TradingSettings } from "@/lib/types";
import { PageLayout, SurfaceCard } from "@/components/ui/shell";
import { displayNameFromEmail } from "@/lib/displayName";
import { useMe } from "@/hooks/useMe";
import { DashboardAnalytics } from "@/components/dashboard/DashboardAnalytics";
import { AgentStatusBar } from "@/components/dashboard/AgentStatusBar";
import { WaitingRoom } from "@/components/dashboard/WaitingRoom";
import { parseWatchlist } from "@/lib/allowedAssets";
import type { TradeIntent } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار الموافقة",
  active: "مفعّل",
  suspended: "موقوف",
};

export default function DashboardClient({
  user,
  settings,
  limits,
  mtConnected = false,
  mtOnline = false,
  pendingIntentCount = 0,
  pendingIntents = [],
  trades = [],
}: {
  user: PublicUser;
  settings: TradingSettings;
  limits: AdminLimits;
  mtConnected?: boolean;
  mtOnline?: boolean;
  pendingIntentCount?: number;
  pendingIntents?: TradeIntent[];
  trades?: Trade[];
}) {
  const { data: me } = useMe();

  const used = me?.quota.used ?? 0;
  const remaining = me?.quota.remaining ?? Math.max(0, limits.claude_quota - used);
  const limit = me?.quota.limit ?? limits.claude_quota;
  const displayName = displayNameFromEmail(user.email);
  const tgLinked = Boolean(settings.telegram_chat_id);

  return (
    <FadeIn>
    <PageLayout
      title="حسابي"
      subtitle="لوحة الحساب والرصيد"
      maxWidth="6xl"
    >

      <AgentStatusBar />

      <WaitingRoom
        settings={settings}
        pendingIntents={pendingIntents}
        watchlistCount={parseWatchlist(settings.allowed_assets).length}
      />

      {pendingIntentCount > 0 && (
        <Link href="/console/trades" className="block">
          <SurfaceCard className="flex items-center justify-between gap-3 border-chart-1/40 bg-chart-1/5 transition hover:bg-chart-1/10">
            <div>
              <p className="font-semibold text-foreground">
                {pendingIntentCount === 1
                  ? "صفقة واحدة بانتظار موافقتك"
                  : `${pendingIntentCount} صفقات بانتظار موافقتك`}
              </p>
              <p className="text-sm text-muted-foreground">
                راجع الطلبات ووافق أو ارفض من صفحة الصفقات
              </p>
            </div>
            <BarChart3 className="h-5 w-5 shrink-0 text-chart-1" />
          </SurfaceCard>
        </Link>
      )}

      <SurfaceCard className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-secondary text-lg font-semibold text-foreground">
          {displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{displayName}</p>
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
          <p className="text-xl font-semibold sm:text-2xl">{remaining}</p>
        </SurfaceCard>
        <SurfaceCard padding="sm" className="text-center">
          <p className="text-[10px] text-muted-foreground sm:text-xs">مُستهلك</p>
          <p className="text-xl font-semibold sm:text-2xl">{used}</p>
        </SurfaceCard>
        <SurfaceCard padding="sm" className="text-center">
          <p className="text-[10px] text-muted-foreground sm:text-xs">الإجمالي</p>
          <p className="text-xl font-semibold sm:text-2xl">{limit}</p>
        </SurfaceCard>
      </div>

      <DashboardAnalytics trades={trades} />

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
        <Link href="/console/connect" className="block">
          <SurfaceCard className="flex items-center gap-3 transition hover:bg-secondary/50">
            <ArrowLeftRight className="h-5 w-5 text-accent-gold" />
            <div>
              <p className="font-medium">ربط MetaTrader (فوركس)</p>
              <p className="text-xs text-muted-foreground">
                {mtOnline
                  ? "متصل"
                  : mtConnected
                    ? "مربوط — غير متصل"
                    : "غير مربوط"}
              </p>
            </div>
          </SurfaceCard>
        </Link>

        <Link href="/console/trades" className="block">
          <SurfaceCard className="flex items-center gap-3 transition hover:bg-secondary/50">
            <BarChart3 className="h-5 w-5 text-accent-gold" />
            <div>
              <p className="font-medium">الصفقات</p>
              <p className="text-xs text-muted-foreground">سجل التنفيذ</p>
            </div>
          </SurfaceCard>
        </Link>

        <Link href="/console/connect" className="block">
          <SurfaceCard className="flex items-center gap-3 transition hover:bg-secondary/50">
            <LineChart className="h-5 w-5 text-accent-gold" />
            <div>
              <p className="font-medium">الشارت</p>
              <p className="text-xs text-muted-foreground">تحليل فني مباشر</p>
            </div>
          </SurfaceCard>
        </Link>

        <Link href="/reports" className="block">
          <SurfaceCard className="flex items-center gap-3 transition hover:bg-secondary/50">
            <FileText className="h-5 w-5 text-accent-gold" />
            <div>
              <p className="font-medium">التقارير</p>
              <p className="text-xs text-muted-foreground">ملخصات وتصدير</p>
            </div>
          </SurfaceCard>
        </Link>

      </div>

      {limits.can_execute === 0 && (
        <SurfaceCard className="flex items-start gap-3 border-accent-gold/30">
          <Shield className="mt-0.5 h-5 w-5 text-accent-gold" />
          <p className="text-sm text-muted-foreground">
            التنفيذ التلقائي غير مفعّل. تواصل مع الإدارة لتفعيله.
          </p>
        </SurfaceCard>
      )}
    </PageLayout>
    </FadeIn>
  );
}
