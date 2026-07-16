"use client";

import { useState } from "react";
import type { AdminUserView } from "@/lib/store";
import { DEFAULT_ACCESS_DAYS, accessDaysRemaining } from "@/lib/platformAccess";
import { displayNameForUser } from "@/lib/displayName";
import { formatWhatsAppDisplay } from "@/lib/phone";
import { isSyntheticTelegramEmail } from "@/lib/userCredentials";
import { cn } from "@/lib/utils";

type TableMode = "full" | "limits";

function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatExpiryCell(
  iso: string | null | undefined,
  status: string,
): string {
  const date = formatExpiry(iso);
  if (!iso || status !== "active") return date;
  const days = accessDaysRemaining(iso);
  if (days === null || days === 0) return date;
  return `${date} (متبقي ${days} يوم)`;
}

export function AdminUsersTable({
  initialUsers,
  adminId,
  mode = "full",
}: {
  initialUsers: AdminUserView[];
  adminId: number;
  mode?: TableMode;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [accessDays, setAccessDays] = useState<Record<number, number>>({});

  function daysFor(userId: number): number {
    return accessDays[userId] ?? DEFAULT_ACCESS_DAYS;
  }

  async function refresh() {
    const r = await fetch("/api/admin/users");
    const data = await r.json();
    setUsers(data.users);
  }

  async function patch(userId: number, body: Record<string, unknown>) {
    setSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) await refresh();
      else {
        const data = await res.json();
        alert(data.error ?? "فشل الحفظ.");
      }
    } finally {
      setSavingId(null);
    }
  }

  async function remove(userId: number, email: string) {
    if (!confirm(`حذف المستخدم ${email} نهائياً؟ لا يمكن التراجع.`)) return;
    setDeletingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (res.ok) await refresh();
      else {
        const data = await res.json();
        alert(data.error ?? "فشل الحذف.");
      }
    } finally {
      setDeletingId(null);
    }
  }

  function update(userId: number, key: keyof AdminUserView, value: unknown) {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, [key]: value } : u)),
    );
  }

  return (
    <div className="admin-card overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead className="border-b border-white/10 text-muted-foreground">
          <tr>
            <th className="p-3">المستخدم</th>
            {mode === "full" && <th className="p-3">المصدر</th>}
            {mode === "full" && <th className="p-3">واتساب</th>}
            {mode === "full" && <th className="p-3">الحالة</th>}
            {mode === "full" && <th className="p-3">صلاحية حتى</th>}
            {mode === "full" && <th className="p-3">أيام</th>}
            <th className="p-3">التنفيذ</th>
            <th className="p-3">حصة Claude</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {users
            .filter((u) => u.role !== "admin")
            .map((u) => (
              <tr key={u.id} className="border-b border-white/5">
                <td className="p-3">
                  <div dir="ltr" className="text-xs">
                    <p className="font-medium">{displayNameForUser(u)}</p>
                    <p className="text-muted-foreground">{u.email}</p>
                    {isSyntheticTelegramEmail(u.email) && (
                      <span className="mt-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                        Telegram — بريد MCP ناقص
                      </span>
                    )}
                    {u.username && u.username !== displayNameForUser(u) && (
                      <p className="text-muted-foreground">@{u.username}</p>
                    )}
                  </div>
                </td>
                {mode === "full" && (
                  <td className="p-3 text-xs">
                    {u.signup_via === "telegram" ? "Telegram" : "بريد"}
                  </td>
                )}
                {mode === "full" && (
                  <td className="p-3 text-xs" dir="ltr">
                    {u.whatsapp_e164
                      ? formatWhatsAppDisplay(u.whatsapp_e164)
                      : "—"}
                  </td>
                )}
                {mode === "full" && (
                  <td className="p-3">
                    <select
                      className="admin-input py-1 text-xs"
                      value={u.status}
                      disabled={u.id === adminId}
                      onChange={(e) => update(u.id, "status", e.target.value)}
                    >
                      <option value="pending">معلّق</option>
                      <option value="active">مفعّل</option>
                      <option value="suspended">موقوف</option>
                    </select>
                  </td>
                )}
                {mode === "full" && (
                  <td className="p-3 text-xs">{formatExpiryCell(u.access_expires_at, u.status)}</td>
                )}
                {mode === "full" && (
                  <td className="p-3">
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      className="admin-input w-16 py-1 text-xs"
                      value={daysFor(u.id)}
                      onChange={(e) =>
                        setAccessDays((prev) => ({
                          ...prev,
                          [u.id]: Number(e.target.value) || DEFAULT_ACCESS_DAYS,
                        }))
                      }
                    />
                  </td>
                )}
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={Boolean(u.can_execute)}
                    onChange={(e) =>
                      update(u.id, "can_execute", e.target.checked ? 1 : 0)
                    }
                  />
                </td>
                <td className="p-3">
                  <input
                    type="number"
                    min={0}
                    className="admin-input w-20 py-1 text-xs"
                    value={u.claude_quota}
                    onChange={(e) =>
                      update(u.id, "claude_quota", Number(e.target.value))
                    }
                  />
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {mode === "full" && (
                      <>
                        <button
                          type="button"
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white"
                          disabled={savingId === u.id}
                          onClick={() =>
                            patch(u.id, {
                              status: "active",
                              access_days: daysFor(u.id),
                            })
                          }
                        >
                          {savingId === u.id ? "…" : "موافقة"}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-primary/40 px-2 py-1 text-xs text-primary"
                          disabled={savingId === u.id || u.status !== "active"}
                          onClick={() =>
                            patch(u.id, {
                              access_days: daysFor(u.id),
                              renew: true,
                            })
                          }
                        >
                          تجديد
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                      disabled={savingId === u.id}
                      onClick={() =>
                        patch(u.id, {
                          ...(mode === "full" ? { status: u.status } : {}),
                          can_execute: Boolean(u.can_execute),
                           claude_quota: Number(u.claude_quota),
                        })
                      }
                    >
                      {savingId === u.id ? "…" : "حفظ"}
                    </button>
                    {mode === "full" && u.id !== adminId && (
                      <button
                        type="button"
                        className="rounded-lg border border-destructive/40 px-2 py-1 text-xs text-destructive"
                        disabled={deletingId === u.id}
                        onClick={() => remove(u.id, u.email)}
                      >
                        {deletingId === u.id ? "…" : "حذف"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {users.filter((u) => u.role !== "admin").length === 0 && (
        <p className="p-6 text-center text-sm text-muted-foreground">
          لا يوجد مستخدمون بعد.
        </p>
      )}
    </div>
  );
}

export function AdminStatGrid({
  stats,
}: {
  stats: {
    label: string;
    value: number | string;
    hint?: string;
    className?: string;
  }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="admin-card p-4">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className={cn("mt-1 text-2xl font-bold", s.className)}>{s.value}</p>
          {s.hint && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">{s.hint}</p>
          )}
        </div>
      ))}
    </div>
  );
}
