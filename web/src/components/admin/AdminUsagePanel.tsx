"use client";

import { useEffect, useState } from "react";
import type { ClaudeUsageRow } from "@/lib/store";
import { cn } from "@/lib/utils";

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">مراقبة استهلاك Claude</h2>
        <p className="text-sm text-muted-foreground">
          استهلاك كل مستخدم اليوم مقابل الحصة المحددة — لمنع الاستنزاف.
        </p>
      </div>

      <div className="admin-card overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-white/10 text-muted-foreground">
            <tr>
              <th className="p-3">المستخدم</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">المستخدم اليوم</th>
              <th className="p-3">الحصة</th>
              <th className="p-3">النسبة</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((row) => {
              const pct =
                row.quota > 0
                  ? Math.round((row.used_today / row.quota) * 100)
                  : 0;
              const hot = pct >= 90;
              return (
                <tr key={row.user_id} className="border-b border-white/5">
                  <td className="p-3" dir="ltr">
                    {row.email}
                  </td>
                  <td className="p-3">{statusAr(row.status)}</td>
                  <td className="p-3 font-mono">{row.used_today}</td>
                  <td className="p-3 font-mono">{row.quota}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            hot ? "bg-destructive" : "bg-primary",
                          )}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "text-xs",
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
  );
}

function statusAr(status: string) {
  if (status === "active") return "مفعّل";
  if (status === "pending") return "معلّق";
  if (status === "suspended") return "موقوف";
  return status;
}
