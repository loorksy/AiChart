"use client";

import { useEffect, useState } from "react";
import type { ClaudeUsageRow } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Cpu, Users, BarChart3, Activity } from "lucide-react";
import { StatusChip } from "@/components/bridge/StatusChip";

export function AdminUsagePanel({
  initialUsage,
}: {
  initialUsage: ClaudeUsageRow[];
}) {
  const [usage, setUsage] = useState(initialUsage);

  useEffect(() => {
    const id = setInterval(async () => {
      const r = await fetch("/api/admin/usage");
      if (r.ok) {
        const data = await r.json();
        setUsage(data.usage);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const totalCalls = usage.reduce((acc, curr) => acc + curr.used_today, 0);
  const totalQuota = usage.reduce((acc, curr) => acc + curr.quota, 0);
  const avgUsagePct = totalQuota > 0 ? Math.round((totalCalls / totalQuota) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Cpu className="h-5 w-5 text-primary" />
            مراقبة استهلاك Claude
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            استهلاك كل مستخدم اليوم مقابل الحصة المحددة — لمنع استنزاف الرصيد.
          </p>
        </div>
      </div>

      {/* Top Stat Cards (21st.dev Bento Grid style) */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card/45 backdrop-blur-md p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">إجمالي الاستدعاءات اليوم</span>
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <p className="text-2xl font-bold mt-1.5 tracking-tight font-mono text-foreground">
            {totalCalls.toLocaleString()}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/45 backdrop-blur-md p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">إجمالي الحصص اليومية</span>
            <Users className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold mt-1.5 tracking-tight font-mono text-foreground">
            {totalQuota.toLocaleString()}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/45 backdrop-blur-md p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">معدل الاستهلاك العام</span>
            <BarChart3 className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold mt-1.5 tracking-tight font-mono text-emerald-500">
            {avgUsagePct}%
          </p>
        </div>
      </div>

      {/* Data Table */}
      <div className="overflow-hidden rounded-xl border border-border/65 bg-card/35 backdrop-blur-sm shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">المستخدم</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3">الاستخدام اليوم</th>
                <th className="px-4 py-3">الحصة</th>
                <th className="px-4 py-3">النسبة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {usage.map((row) => {
                const pct =
                  row.quota > 0
                    ? Math.round((row.used_today / row.quota) * 100)
                    : 0;
                const hot = pct >= 90;
                return (
                  <tr key={row.user_id} className="transition-colors hover:bg-muted/15">
                    <td className="px-4 py-3 font-medium text-foreground" dir="ltr">
                      {row.email}
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip
                        label={statusAr(row.status)}
                        tone={
                          row.status === "active"
                            ? "ok"
                            : row.status === "pending"
                              ? "warn"
                              : "error"
                        }
                      />
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-foreground">
                      {row.used_today}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {row.quota}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              hot
                                ? "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                                : "bg-primary shadow-[0_0_8px_rgba(16,185,129,0.3)]",
                            )}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "text-xs font-mono font-semibold",
                            hot ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function statusAr(status: string) {
  if (status === "active") return "مفعّل";
  if (status === "pending") return "معلّق";
  if (status === "suspended") return "موقوف";
  return status;
}
