"use client";

import { useMemo, useState } from "react";
import { Search, UserPlus, Users } from "lucide-react";

import type { AdminUserView } from "@/lib/store";
import { DEFAULT_ACCESS_DAYS, accessDaysRemaining } from "@/lib/platformAccess";
import { displayNameForUser } from "@/lib/displayName";
import { formatWhatsAppDisplay } from "@/lib/phone";
import { isSyntheticTelegramEmail } from "@/lib/userCredentials";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import {
  AdminCard,
  AdminCardHeader,
  AdminPage,
  AdminTable,
  InlineAlert,
  RecordCard,
  SortTh,
  Spinner,
  StatGrid,
  StatTile,
  THead,
  Td,
  Th,
  TableEmptyRow,
  TableWrap,
  Tr,
  sortSign,
  useAdminSort,
} from "@/components/admin/ui/AdminKit";

type TableMode = "full" | "limits";

/** `natural` keeps the order the API returned until an admin picks a column. */
type UsersSortKey = "natural" | "user" | "status" | "expiry";

const STATUS_LABEL: Record<string, string> = {
  pending: "معلّق",
  active: "مفعّل",
  suspended: "موقوف",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  pending: "secondary",
  suspended: "destructive",
};

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

function expiryMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { key: sortKey, dir, sortProps } = useAdminSort<UsersSortKey>("natural");

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
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await refresh();
        setNotice("حُفظت التغييرات.");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error ??
            "فشل الحفظ — تحقّق من الاتصال ثم أعد المحاولة، ولم تتغيّر بيانات المستخدم.",
        );
      }
    } catch {
      setError("تعذّر الوصول إلى الخادم — لم يُحفظ أي تغيير. أعد المحاولة.");
    } finally {
      setSavingId(null);
    }
  }

  async function remove(userId: number, email: string) {
    if (!confirm(`حذف المستخدم ${email} نهائياً؟ لا يمكن التراجع.`)) return;
    setDeletingId(userId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (res.ok) {
        await refresh();
        setNotice(`حُذف الحساب ${email}.`);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "فشل الحذف — الحساب ما زال موجوداً. أعد المحاولة.");
      }
    } catch {
      setError("تعذّر الوصول إلى الخادم — لم يُحذف الحساب.");
    } finally {
      setDeletingId(null);
    }
  }

  function update(userId: number, key: keyof AdminUserView, value: unknown) {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, [key]: value } : u)),
    );
  }

  const members = useMemo(
    () => users.filter((u) => u.role !== "admin"),
    [users],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? members.filter(
          (u) =>
            u.email.toLowerCase().includes(needle) ||
            displayNameForUser(u).toLowerCase().includes(needle) ||
            (u.username ?? "").toLowerCase().includes(needle),
        )
      : members;
    if (sortKey === "natural") return filtered;
    const sign = sortSign(dir);
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "user":
          return sign * a.email.localeCompare(b.email, "en");
        case "status":
          return sign * a.status.localeCompare(b.status, "en");
        case "expiry": {
          const av = expiryMs(a.access_expires_at);
          const bv = expiryMs(b.access_expires_at);
          // Accounts with no expiry sort last in both directions — "soonest
          // first" must not mean "never expires first".
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return sign * (av - bv);
        }
        default:
          return 0;
      }
    });
  }, [members, search, sortKey, dir]);

  const stats = useMemo(
    () => ({
      total: members.length,
      active: members.filter((u) => u.status === "active").length,
      pending: members.filter((u) => u.status === "pending").length,
      suspended: members.filter((u) => u.status === "suspended").length,
    }),
    [members],
  );

  const full = mode === "full";
  const columnCount = full ? 9 : 4;

  /** Shared by the table row and the mobile card so the two cannot diverge. */
  function rowActions(u: AdminUserView) {
    const busy = savingId === u.id;
    return (
      <>
        {full && (
          <>
            <Button
              type="button"
              size="sm"
              className="tap-target"
              disabled={busy}
              onClick={() =>
                patch(u.id, { status: "active", access_days: daysFor(u.id) })
              }
            >
              {busy ? <Spinner /> : null}
              موافقة
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="tap-target"
              disabled={busy || u.status !== "active"}
              title={
                u.status !== "active"
                  ? "التجديد متاح للحسابات المفعّلة فقط"
                  : undefined
              }
              onClick={() =>
                patch(u.id, { access_days: daysFor(u.id), renew: true })
              }
            >
              تجديد
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="tap-target"
          disabled={busy}
          onClick={() =>
            patch(u.id, {
              ...(full ? { status: u.status } : {}),
              can_execute: Boolean(u.can_execute),
              claude_quota: Number(u.claude_quota),
            })
          }
        >
          {busy ? <Spinner /> : null}
          حفظ
        </Button>
        {full && u.id !== adminId && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="tap-target"
            disabled={deletingId === u.id}
            onClick={() => remove(u.id, u.email)}
          >
            {deletingId === u.id ? <Spinner /> : null}
            حذف
          </Button>
        )}
      </>
    );
  }

  function statusSelect(u: AdminUserView, id: string) {
    return (
      <select
        id={id}
        aria-label={`حالة الحساب ${u.email}`}
        className="admin-input focus-ring tap-target h-9 w-full min-w-28 py-1 text-xs"
        value={u.status}
        disabled={u.id === adminId}
        onChange={(e) => update(u.id, "status", e.target.value)}
      >
        <option value="pending">معلّق</option>
        <option value="active">مفعّل</option>
        <option value="suspended">موقوف</option>
      </select>
    );
  }

  function quotaInput(u: AdminUserView, id: string) {
    return (
      <Input
        id={id}
        type="number"
        min={0}
        dir="ltr"
        aria-label={`حصة Claude اليومية لـ ${u.email}`}
        className="tap-target h-9 w-24 text-xs"
        value={u.claude_quota}
        onChange={(e) => update(u.id, "claude_quota", Number(e.target.value))}
      />
    );
  }

  function executeCheckbox(u: AdminUserView, id: string) {
    return (
      <input
        id={id}
        type="checkbox"
        aria-label={`السماح بالتنفيذ لـ ${u.email}`}
        className="focus-ring size-4 accent-[var(--primary)]"
        checked={Boolean(u.can_execute)}
        onChange={(e) => update(u.id, "can_execute", e.target.checked ? 1 : 0)}
      />
    );
  }

  return (
    <AdminPage dir="rtl" data-testid="admin-users-panel">
      {full && (
        <StatGrid>
          <StatTile label="إجمالي المستخدمين" value={stats.total} icon={Users} index={0} />
          <StatTile label="مفعّلون" value={stats.active} tone="positive" index={1} />
          <StatTile
            label="بانتظار الموافقة"
            value={stats.pending}
            tone={stats.pending > 0 ? "warning" : "neutral"}
            index={2}
          />
          <StatTile
            label="موقوفون"
            value={stats.suspended}
            tone={stats.suspended > 0 ? "negative" : "neutral"}
            index={3}
          />
        </StatGrid>
      )}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && !error && <InlineAlert tone="ok">{notice}</InlineAlert>}

      <AdminCard>
        <AdminCardHeader
          title={full ? "المستخدمون" : "حدود الاستخدام"}
          description={
            full
              ? "الموافقة على الحسابات، مدّة الصلاحية، صلاحية التنفيذ وحصة Claude اليومية."
              : "صلاحية التنفيذ وحصة Claude اليومية لكل حساب."
          }
          actions={
            <div className="relative w-full sm:w-64">
              <Search
                aria-hidden
                className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالبريد أو الاسم"
                aria-label="بحث في المستخدمين"
                className="tap-target h-9 ps-8 text-sm"
              />
            </div>
          }
        />

        {/* Below 640px a nine-column roster is unreadable as a grid, so each
            account becomes its own card with the same controls. */}
        <div className="space-y-2 p-3 sm:hidden">
          {visible.length === 0 ? (
            <EmptyRoster hasUsers={members.length > 0} />
          ) : (
            visible.map((u, i) => (
              <RecordCard
                key={u.id}
                index={i}
                title={displayNameForUser(u)}
                subtitle={u.email}
                badge={
                  full ? (
                    <Badge variant={STATUS_VARIANT[u.status] ?? "outline"}>
                      {STATUS_LABEL[u.status] ?? u.status}
                    </Badge>
                  ) : null
                }
                fields={[
                  ...(full
                    ? [
                        {
                          label: "المصدر",
                          value: u.signup_via === "telegram" ? "Telegram" : "بريد",
                        },
                        {
                          label: "واتساب",
                          value: (
                            <span dir="ltr">
                              {u.whatsapp_e164
                                ? formatWhatsAppDisplay(u.whatsapp_e164)
                                : "—"}
                            </span>
                          ),
                        },
                        {
                          label: "صلاحية حتى",
                          value: formatExpiryCell(u.access_expires_at, u.status),
                        },
                        {
                          label: "أيام التجديد",
                          value: (
                            <Input
                              type="number"
                              min={1}
                              max={3650}
                              dir="ltr"
                              aria-label={`عدد أيام الصلاحية لـ ${u.email}`}
                              className="tap-target h-9 w-20 text-xs"
                              value={daysFor(u.id)}
                              onChange={(e) =>
                                setAccessDays((prev) => ({
                                  ...prev,
                                  [u.id]: Number(e.target.value) || DEFAULT_ACCESS_DAYS,
                                }))
                              }
                            />
                          ),
                        },
                        {
                          label: "الحالة",
                          value: statusSelect(u, `m-status-${u.id}`),
                        },
                      ]
                    : []),
                  {
                    label: "التنفيذ",
                    value: (
                      <label
                        htmlFor={`m-exec-${u.id}`}
                        className="tap-target inline-flex items-center gap-2 text-sm"
                      >
                        {executeCheckbox(u, `m-exec-${u.id}`)}
                        <span>{u.can_execute ? "مسموح" : "ممنوع"}</span>
                      </label>
                    ),
                  },
                  {
                    label: "حصة Claude",
                    value: quotaInput(u, `m-quota-${u.id}`),
                  },
                ]}
                actions={rowActions(u)}
              />
            ))
          )}
        </div>

        <TableWrap className="hidden sm:block" maxHeight="max-h-[36rem]">
          <AdminTable className="min-w-[52rem]">
            <caption className="sr-only">
              قائمة المستخدمين مع حالتهم وصلاحياتهم وحصصهم
            </caption>
            <THead sticky>
              <tr>
                <SortTh label="المستخدم" {...sortProps("user")} />
                {full && <Th>المصدر</Th>}
                {full && <Th>واتساب</Th>}
                {full && <SortTh label="الحالة" {...sortProps("status")} />}
                {full && <SortTh label="صلاحية حتى" {...sortProps("expiry")} />}
                {full && <Th>أيام</Th>}
                <Th>التنفيذ</Th>
                <Th>حصة Claude</Th>
                <Th className="text-end">إجراءات</Th>
              </tr>
            </THead>
            <tbody>
              {visible.length === 0 ? (
                <TableEmptyRow
                  colSpan={columnCount}
                  icon={members.length > 0 ? Search : UserPlus}
                  title={
                    members.length > 0
                      ? "لا يوجد مستخدم مطابق للبحث"
                      : "لا يوجد مستخدمون بعد"
                  }
                  description={
                    members.length > 0
                      ? "جرّب بريداً أو اسماً آخر، أو امسح مربع البحث."
                      : "ستظهر الحسابات هنا فور أول تسجيل عبر الموقع أو تليجرام."
                  }
                  action={
                    members.length > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                        مسح البحث
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                visible.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <div dir="ltr" className="text-start text-xs">
                        <p className="font-medium text-foreground">
                          {displayNameForUser(u)}
                        </p>
                        <p className="text-muted-foreground">{u.email}</p>
                        {isSyntheticTelegramEmail(u.email) && (
                          <span className="mt-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                            Telegram — بريد MCP ناقص
                          </span>
                        )}
                        {u.username && u.username !== displayNameForUser(u) && (
                          <p className="text-muted-foreground">@{u.username}</p>
                        )}
                      </div>
                    </Td>
                    {full && (
                      <Td className="text-xs text-muted-foreground">
                        {u.signup_via === "telegram" ? "Telegram" : "بريد"}
                      </Td>
                    )}
                    {full && (
                      <Td className="text-xs text-muted-foreground" dir="ltr">
                        {u.whatsapp_e164
                          ? formatWhatsAppDisplay(u.whatsapp_e164)
                          : "—"}
                      </Td>
                    )}
                    {full && <Td>{statusSelect(u, `status-${u.id}`)}</Td>}
                    {full && (
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatExpiryCell(u.access_expires_at, u.status)}
                      </Td>
                    )}
                    {full && (
                      <Td>
                        <Input
                          type="number"
                          min={1}
                          max={3650}
                          dir="ltr"
                          aria-label={`عدد أيام الصلاحية لـ ${u.email}`}
                          className="h-9 w-20 text-xs"
                          value={daysFor(u.id)}
                          onChange={(e) =>
                            setAccessDays((prev) => ({
                              ...prev,
                              [u.id]: Number(e.target.value) || DEFAULT_ACCESS_DAYS,
                            }))
                          }
                        />
                      </Td>
                    )}
                    <Td>{executeCheckbox(u, `exec-${u.id}`)}</Td>
                    <Td>{quotaInput(u, `quota-${u.id}`)}</Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {rowActions(u)}
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </AdminTable>
        </TableWrap>
      </AdminCard>
    </AdminPage>
  );
}

function EmptyRoster({ hasUsers }: { hasUsers: boolean }) {
  return (
    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
      {hasUsers
        ? "لا يوجد مستخدم مطابق للبحث."
        : "لا يوجد مستخدمون بعد — ستظهر الحسابات فور أول تسجيل."}
    </p>
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
    <StatGrid>
      {stats.map((s, i) => (
        <StatTile
          key={s.label}
          index={i}
          label={s.label}
          value={<span className={cn(s.className)}>{s.value}</span>}
          hint={s.hint}
        />
      ))}
    </StatGrid>
  );
}
