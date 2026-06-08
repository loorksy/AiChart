"use client";

import { useState } from "react";
import type { AdminUserView } from "@/lib/store";
import { cn } from "@/lib/utils";

type TableMode = "full" | "limits";

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
            {mode === "full" && <th className="p-3">الحالة</th>}
            {mode === "full" && <th className="p-3">Binance</th>}
            <th className="p-3">التنفيذ</th>
            <th className="p-3">سقف رأس المال</th>
            <th className="p-3">أقصى صفقات</th>
            <th className="p-3">حصة Claude</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {users
            .filter((u) => u.role !== "admin")
            .map((u) => (
              <tr key={u.id} className="border-b border-white/5">
                <td className="p-3" dir="ltr">
                  {u.email}
                </td>
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
                  <td className="p-3">
                    {u.has_binance ? (
                      <span className="text-primary">
                        {u.binance_env === "testnet" ? "تجريبي" : "حقيقي"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
                    className="admin-input w-24 py-1 text-xs"
                    value={u.max_capital_cap}
                    onChange={(e) =>
                      update(u.id, "max_capital_cap", Number(e.target.value))
                    }
                  />
                </td>
                <td className="p-3">
                  <input
                    type="number"
                    min={1}
                    className="admin-input w-16 py-1 text-xs"
                    value={u.max_open_trades_cap}
                    onChange={(e) =>
                      update(u.id, "max_open_trades_cap", Number(e.target.value))
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
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                      disabled={savingId === u.id}
                      onClick={() =>
                        patch(u.id, {
                          ...(mode === "full" ? { status: u.status } : {}),
                          can_execute: Boolean(u.can_execute),
                          max_capital_cap: Number(u.max_capital_cap),
                          max_open_trades_cap: Number(u.max_open_trades_cap),
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
