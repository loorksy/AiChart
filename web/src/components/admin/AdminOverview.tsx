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
import { cn } from "@/lib/utils";
import { StatGrid, StatTile } from "@/components/admin/ui/AdminKit";

/**
 * The compact platform snapshot. It renders inside the bridge overview as well
 * as on its own, so it deliberately owns no page shell — the host decides the
 * width and the surrounding rhythm.
 */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="type-overline">{title}</h3>
      <StatGrid>{children}</StatGrid>
    </section>
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
        <div className="space-y-1">
          <h2 className="type-title">نظرة عامة</h2>
          <p className="type-caption">إحصائيات المنصة والتحكّم الطارئ</p>
        </div>
      )}

      <Section title="المستخدمون">
        <StatTile
          index={0}
          label="إجمالي المستخدمين"
          value={stats.users_total}
          icon={Users}
        />
        <StatTile
          index={1}
          label="مفعّلون"
          value={stats.users_active}
          hint={`${activeRate}% من الإجمالي`}
          icon={CheckCircle2}
          tone="positive"
        />
        <StatTile
          index={2}
          label="بانتظار الموافقة"
          value={stats.users_pending}
          icon={Clock}
          tone={stats.users_pending > 0 ? "warning" : "neutral"}
        />
        <StatTile
          index={3}
          label="مرتبطون بـ MetaTrader"
          value={stats.users_with_mt5}
          icon={Link2}
        />
      </Section>

      <Section title="النشاط التداولي">
        <StatTile
          index={0}
          label="صفقات منفّذة"
          value={stats.trades_total}
          icon={BarChart3}
        />
        <StatTile
          index={1}
          label="صفقات مفتوحة"
          value={stats.trades_open}
          icon={Activity}
        />
        <StatTile
          index={2}
          label="طلبات بانتظار الموافقة"
          value={stats.intents_pending}
          icon={Clock}
          tone={stats.intents_pending > 0 ? "warning" : "neutral"}
        />
        <StatTile
          index={3}
          label="توصيات مسجّلة"
          value={stats.recommendations_total}
          icon={BarChart3}
        />
      </Section>

      <Section title="استهلاك الوكيل">
        <StatTile
          index={0}
          label="استدعاءات Claude اليوم"
          value={stats.claude_calls_today}
          hint="على مستوى المنصة"
          icon={Cpu}
        />
        <StatTile
          index={1}
          label="موقوفون"
          value={stats.users_suspended}
          icon={Users}
          tone={stats.users_suspended > 0 ? "negative" : "neutral"}
        />
        <StatTile
          index={2}
          label="صفقات مكتملة (Intents)"
          value={stats.intents_executed}
          icon={CheckCircle2}
        />
      </Section>
    </div>
  );
}
