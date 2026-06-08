import type { AdminPlatformStats } from "@/lib/store";
import { MasterKillCard } from "@/components/admin/MasterKillCard";
import { AdminStatGrid } from "@/components/admin/AdminUsersTable";

export function AdminOverview({
  stats,
  masterKill,
}: {
  stats: AdminPlatformStats;
  masterKill: boolean;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">نظرة عامة</h2>
        <p className="text-sm text-muted-foreground">
          إحصائيات المنصة والتحكّم الطارئ — حسب خطة المشروع (القسم 7).
        </p>
      </div>

      <MasterKillCard initialOn={masterKill} />

      <AdminStatGrid
        stats={[
          { label: "إجمالي المستخدمين", value: stats.users_total },
          { label: "مفعّلون", value: stats.users_active, className: "text-primary" },
          {
            label: "بانتظار الموافقة",
            value: stats.users_pending,
            className: "text-chart-1",
          },
          { label: "موقوفون", value: stats.users_suspended },
          { label: "مرتبطون بـ Binance", value: stats.users_with_binance },
          { label: "صفقات منفّذة", value: stats.trades_total },
          { label: "صفقات مفتوحة", value: stats.trades_open },
          {
            label: "طلبات بانتظار الموافقة",
            value: stats.intents_pending,
          },
          { label: "توصيات مسجّلة", value: stats.recommendations_total },
          {
            label: "استدعاءات Claude اليوم",
            value: stats.claude_calls_today,
            hint: "على مستوى المنصة",
          },
        ]}
      />
    </div>
  );
}
