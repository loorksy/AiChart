import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Link2,
  Users,
  TrendingUp,
} from "lucide-react";
import type { AdminPlatformStats } from "@/lib/store";
import { cn } from "@/lib/utils";

/* ─── Bento stat tile ─── */
function StatTile({
  label,
  value,
  icon: Icon,
  hint,
  accent = false,
  trend,
}: {
  label: string;
  value: number | string;
  icon: typeof Users;
  hint?: string;
  accent?: boolean;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="bento-card group flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 transition-all",
            accent
              ? "bg-green-500/10 ring-green-500/20 group-hover:ring-green-500/40"
              : "bg-white/[0.04] ring-white/[0.06] group-hover:ring-white/[0.10]",
          )}
        >
          <Icon
            className={cn(
              "h-5 w-5",
              accent ? "text-green-400" : "text-zinc-500",
            )}
          />
        </span>
        {trend && (
          <TrendingUp
            className={cn(
              "h-4 w-4",
              trend === "up"
                ? "text-green-400"
                : trend === "down"
                  ? "text-red-400 rotate-180"
                  : "text-zinc-600",
            )}
          />
        )}
      </div>
      <div>
        <p className="console-stat-value">{value}</p>
        <p className="mt-1.5 text-xs font-medium text-zinc-500">{label}</p>
        {hint && (
          <p className="mt-0.5 text-[10px] text-zinc-700">{hint}</p>
        )}
      </div>
    </div>
  );
}

/* ─── Section container ─── */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="console-section-label">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

export function AdminOverview({
  stats,
  embedded = false,
}: {
  stats: AdminPlatformStats;
  embedded?: boolean;
}) {
  const activeRate = stats.users_total
    ? Math.round((stats.users_active / stats.users_total) * 100)
    : 0;

  return (
    <div className={cn("space-y-6", !embedded && "mx-auto max-w-6xl")}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight">نظرة عامة</h1>
          <p className="mt-1 text-sm text-zinc-500">
            إحصائيات المنصة والتحكّم الطارئ
          </p>
        </div>
      )}

      <Section title="المستخدمون">
        <StatTile
          label="إجمالي المستخدمين"
          value={stats.users_total}
          icon={Users}
          accent
          trend="up"
        />
        <StatTile
          label="مفعّلون"
          value={stats.users_active}
          icon={CheckCircle2}
          hint={`${activeRate}% من الإجمالي`}
          accent
        />
        <StatTile
          label="بانتظار الموافقة"
          value={stats.users_pending}
          icon={Clock}
        />
        <StatTile
          label="مرتبطون بـ MetaTrader"
          value={stats.users_with_mt5}
          icon={Link2}
        />
      </Section>

      <Section title="النشاط التداولي">
        <StatTile
          label="صفقات منفّذة"
          value={stats.trades_total}
          icon={BarChart3}
          accent
          trend="up"
        />
        <StatTile
          label="صفقات مفتوحة"
          value={stats.trades_open}
          icon={Activity}
        />
        <StatTile
          label="طلبات بانتظار الموافقة"
          value={stats.intents_pending}
          icon={Clock}
        />
        <StatTile
          label="توصيات مسجّلة"
          value={stats.recommendations_total}
          icon={BarChart3}
        />
      </Section>

      <Section title="استهلاك الوكيل">
        <StatTile
          label="استدعاءات Claude اليوم"
          value={stats.claude_calls_today}
          icon={Cpu}
          hint="على مستوى المنصة"
          accent
          trend="up"
        />
        <StatTile
          label="موقوفون"
          value={stats.users_suspended}
          icon={Users}
        />
        <StatTile
          label="صفقات مكتملة (Intents)"
          value={stats.intents_executed}
          icon={CheckCircle2}
        />
      </Section>
    </div>
  );
}
