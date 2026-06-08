"use client";

import { useState } from "react";
import type { AdminUserView } from "@/lib/store";

export default function AdminClient({
  initialUsers,
  adminId,
}: {
  initialUsers: AdminUserView[];
  adminId: number;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [savingId, setSavingId] = useState<number | null>(null);

  async function patch(userId: number, body: Record<string, unknown>) {
    setSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const r = await fetch("/api/admin/users");
        const data = await r.json();
        setUsers(data.users);
      } else {
        const data = await res.json();
        alert(data.error ?? "فشل الحفظ.");
      }
    } finally {
      setSavingId(null);
    }
  }

  function update(userId: number, key: keyof AdminUserView, value: unknown) {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, [key]: value } : u)),
    );
  }

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const pending = users.filter((u) => u.status === "pending").length;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <h1 className="mb-2 text-2xl font-bold">لوحة الإدارة</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        مركز التحكّم الكامل — فعّل المستخدمين وحدّد سقوف التداول لكل مستخدم يدوياً.
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="إجمالي المستخدمين" value={total} />
        <Stat label="المفعّلون" value={active} color="var(--accent)" />
        <Stat label="بانتظار الموافقة" value={pending} color="var(--warning)" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-[var(--border)] text-[var(--muted)]">
            <tr>
              <th className="p-3">المستخدم</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">Binance</th>
              <th className="p-3">التنفيذ</th>
              <th className="p-3">سقف رأس المال</th>
              <th className="p-3">أقصى صفقات</th>
              <th className="p-3">حصة Claude</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--border)]/50">
                <td className="p-3" dir="ltr">
                  {u.email}
                  {u.role === "admin" && (
                    <span className="mr-2 rounded bg-[var(--accent-2)]/20 px-1.5 py-0.5 text-xs text-[var(--accent-2)]">
                      admin
                    </span>
                  )}
                </td>
                <td className="p-3">
                  <select
                    className="input py-1 text-xs"
                    value={u.status}
                    disabled={u.id === adminId}
                    onChange={(e) => update(u.id, "status", e.target.value)}
                  >
                    <option value="pending">معلّق</option>
                    <option value="active">مفعّل</option>
                    <option value="suspended">موقوف</option>
                  </select>
                </td>
                <td className="p-3">
                  {u.has_binance ? (
                    <span className="text-[var(--accent)]">
                      {u.binance_env === "testnet" ? "تجريبي" : "حقيقي"}
                    </span>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
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
                    className="input w-24 py-1 text-xs"
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
                    className="input w-16 py-1 text-xs"
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
                    className="input w-20 py-1 text-xs"
                    value={u.claude_quota}
                    onChange={(e) =>
                      update(u.id, "claude_quota", Number(e.target.value))
                    }
                  />
                </td>
                <td className="p-3">
                  <button
                    className="btn btn-primary py-1 text-xs"
                    disabled={savingId === u.id}
                    onClick={() =>
                      patch(u.id, {
                        status: u.status,
                        can_execute: Boolean(u.can_execute),
                        max_capital_cap: Number(u.max_capital_cap),
                        max_open_trades_cap: Number(u.max_open_trades_cap),
                        claude_quota: Number(u.claude_quota),
                      })
                    }
                  >
                    {savingId === u.id ? "…" : "حفظ"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}
