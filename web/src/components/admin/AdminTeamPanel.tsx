"use client";

import { useCallback, useEffect, useState } from "react";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";

interface AdminRow {
  user_id: number;
  email: string;
  admin_role: string | null;
  granted_at: number | null;
}

const ROLE_AR: Record<string, string> = {
  owner: "مالك (كل الصلاحيات)",
  support: "دعم فني (تذاكر فقط)",
  user_manager: "إدارة مستخدمين",
  content_manager: "إدارة محتوى",
  finance: "مالية (فوترة وأرباح)",
};

/**
 * V2-A6/C follow-up: the team panel — promote a user to admin with a
 * scoped role, change a role, or fully demote. Backed by /api/admin/roles
 * (roles_write = owner only). Every action lands in admin_audit.
 */
export function AdminTeamPanel() {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState("support");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/roles");
    if (res.ok) setAdmins(((await res.json()) as { admins: AdminRow[] }).admins);
    else setMessage("ليست لديك صلاحية إدارة الأدوار (مالك فقط).");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign(userId: number, role: string | null) {
    setMessage(null);
    const res = await fetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, role }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setMessage(
      res.ok
        ? role === null
          ? "أُزيلت صلاحيات الإشراف وعاد الحساب مستخدماً عادياً"
          : "حُدّث الدور — الصلاحيات سارية فوراً"
        : (data.error ?? "فشل الطلب"),
    );
    if (res.ok) void load();
  }

  if (admins === null && !message) return <CardSkeleton lines={5} />;

  return (
    <div className="space-y-4" dir="rtl">
      {message && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">
          {message}
        </p>
      )}

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">إضافة مشرف</h3>
        <p className="text-xs text-muted-foreground">
          خذ رقم المستخدم (ID) من تبويب «المستخدمون»، واختر دوره — الصلاحيات
          تُفرض على مستوى الخادم: مشرف الدعم يرى التذاكر فقط ولا يلمس المفاتيح
          أو المال أبداً.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            placeholder="User ID"
            inputMode="numeric"
            className="w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {Object.entries(ROLE_AR).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <button
            onClick={() => assign(Number(newUserId), newRole)}
            disabled={!newUserId}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            ترقية
          </button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-border bg-card">
        <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
          المشرفون الحاليون
        </h3>
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-right text-[11px] text-muted-foreground">
              <th className="px-4 py-2">المشرف</th>
              <th className="px-2 py-2">الدور</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(admins ?? []).map((row) => (
              <tr key={row.user_id} className="border-b border-border/40">
                <td className="px-4 py-2 text-foreground">
                  {row.email} <span className="text-[10px] text-muted-foreground">#{row.user_id}</span>
                </td>
                <td className="px-2 py-2">
                  <select
                    value={row.admin_role ?? "owner"}
                    onChange={(e) => assign(row.user_id, e.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  >
                    {Object.entries(ROLE_AR).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <button
                    onClick={() => assign(row.user_id, null)}
                    className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    إزالة الإشراف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
