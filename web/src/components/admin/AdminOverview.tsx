import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Link2,
  Users,
} from "lucide-react";
import type { AdminPlatformStats } from "@/lib/store";
import { MasterKillCard } from "@/components/admin/MasterKillCard";
import { cn } from "@/lib/utils";

function StatTile({
  label,
  value,
  icon: Icon,
  hint,
  accent = false,
}: {
  label: string;
  value: number | string;
  icon: typeof Users;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="admin-card flex items-start gap-3 p-4">
      <span
        className={
          accent
            ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary"
            : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-muted-foreground"
        }
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-bold">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

export function AdminOverview({
  stats,
  masterKill,
  embedded = false,
}: {
  stats: AdminPlatformStats;
  masterKill: boolean;
  embedded?: boolean;
}) {
  const activeRate = stats.users_total
    ? Math.round((stats.users_active / stats.users_total) * 100)
    : 0;

  return (
    <div className={cn("space-y-6", !embedded && "mx-auto max-w-6xl")}>
      {!embedded && (
        <div>
          <h2 className="text-xl font-bold">نظرة عامة</h2>
          <p className="text-sm text-muted-foreground">
            إحصائيات المنصة والتحكّم الطارئ
          </p>
        </div>
      )}

      <MasterKillCard initialOn={masterKill} />

      <Section title="المستخدمون">
        <StatTile
          label="إجمالي المستخدمين"
          value={stats.users_total}
          icon={Users}
          accent
        />
        <StatTile
          label="مفعّلون"
          value={stats.users_active}
          icon={CheckCircle2}
          hint={`${activeRate}% من الإجمالي`}
        />
        <StatTile
          label="بانتظار الموافقة"
          value={stats.users_pending}
          icon={Clock}
        />
        <StatTile
          label="مرتبطون بـ Binance"
          value={stats.users_with_binance}
          icon={Link2}
        />
      </Section>

      <Section title="النشاط التداولي">
        <StatTile
          label="صفقات منفّذة"
          value={stats.trades_total}
          icon={BarChart3}
          accent
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
