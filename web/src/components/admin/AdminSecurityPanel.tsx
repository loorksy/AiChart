import { ADMIN_ACTION_LABELS } from "@/components/admin/adminNav";
import { cn } from "@/lib/utils";

type AuditRow = {
  id: number;
  user_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
};

export function AdminSecurityPanel({
  audit,
  securityOnly = false,
}: {
  audit: AuditRow[];
  securityOnly?: boolean;
}) {
  const securityActions = new Set([
    "injection_blocked",
    "trade_execute",
  ]);

  const rows = securityOnly
    ? audit.filter((a) => securityActions.has(a.action))
    : audit;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">
          {securityOnly ? "الأمن" : "سجل التدقيق"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {securityOnly
            ? "محاولات حقن برومبت ونشاط مريب."
            : "كل قرار وصفقة وحدث مهم مع السبب والزمن."}
        </p>
      </div>

      <div className="admin-card overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-white/10 text-muted-foreground">
            <tr>
              <th className="p-3">الوقت</th>
              <th className="p-3">الإجراء</th>
              <th className="p-3">المستخدم</th>
              <th className="p-3">التفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-white/5">
                <td className="p-3 text-xs text-muted-foreground" dir="ltr">
                  {row.created_at.slice(0, 16)}
                </td>
                <td className="p-3">
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      row.action === "injection_blocked"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-secondary text-foreground",
                    )}
                  >
                    {ADMIN_ACTION_LABELS[row.action] ?? row.action}
                  </span>
                </td>
                <td className="p-3 text-muted-foreground">
                  {row.user_id ?? "—"}
                </td>
                <td className="max-w-xs truncate p-3 text-xs text-muted-foreground">
                  {row.detail ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            لا توجد أحداث مسجّلة بعد.
          </p>
        )}
      </div>
    </div>
  );
}
