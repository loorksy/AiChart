"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, UserPlus } from "lucide-react";

import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";
import {
  AdminCard,
  AdminCardBody,
  AdminCardHeader,
  AdminPage,
  AdminTable,
  Field,
  InlineAlert,
  RecordCard,
  SectionHeader,
  Spinner,
  THead,
  Td,
  Th,
  TableEmptyRow,
  TableWrap,
  Tr,
  describedBy,
} from "@/components/admin/ui/AdminKit";

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
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [touched, setTouched] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/roles");
    if (res.ok) setAdmins(((await res.json()) as { admins: AdminRow[] }).admins);
    else {
      setFailed(true);
      setMessage("ليست لديك صلاحية إدارة الأدوار (مالك فقط).");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The field is a raw user id, so anything that is not a positive whole number
  // would reach the API as NaN and come back as an opaque 400.
  const parsedId = Number(newUserId.trim());
  const idError =
    touched && newUserId.trim() === ""
      ? "أدخل رقم المستخدم (ID) من تبويب «المستخدمون»."
      : touched && (!Number.isInteger(parsedId) || parsedId <= 0)
        ? "رقم المستخدم يجب أن يكون عدداً صحيحاً موجباً — انسخه من عمود البريد في تبويب المستخدمون."
        : undefined;
  const canSubmit = Number.isInteger(parsedId) && parsedId > 0;

  async function assign(
    userId: number,
    role: string | null,
    busyKey: number | "new" = userId,
  ) {
    setMessage(null);
    setFailed(false);
    setBusyId(busyKey);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setFailed(!res.ok);
      setMessage(
        res.ok
          ? role === null
            ? "أُزيلت صلاحيات الإشراف وعاد الحساب مستخدماً عادياً"
            : "حُدّث الدور — الصلاحيات سارية فوراً"
          : (data.error ?? "فشل الطلب — لم يتغيّر أي دور. تأكّد من رقم المستخدم ثم أعد المحاولة."),
      );
      if (res.ok) {
        if (role !== null) setNewUserId("");
        setTouched(false);
        void load();
      }
    } catch {
      setFailed(true);
      setMessage("تعذّر الوصول إلى الخادم — لم يتغيّر أي دور.");
    } finally {
      setBusyId(null);
    }
  }

  if (admins === null && !message) {
    return (
      <AdminPage dir="rtl">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={5} />
      </AdminPage>
    );
  }

  const rows = admins ?? [];

  return (
    <AdminPage dir="rtl" data-testid="admin-team-panel">
      <SectionHeader
        title="المشرفون"
        description="من يملك صلاحية الدخول للوحة المنصة، وبأي نطاق. كل تغيير يُسجَّل في سجل التدقيق."
        icon={ShieldCheck}
      />

      {message && (
        <InlineAlert tone={failed ? "error" : "ok"}>{message}</InlineAlert>
      )}

      <AdminCard>
        <AdminCardHeader
          title="إضافة مشرف"
          description="الصلاحيات تُفرض على مستوى الخادم: مشرف الدعم يرى التذاكر فقط ولا يلمس المفاتيح أو المال أبداً."
        />
        <AdminCardBody>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-start"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (canSubmit) void assign(parsedId, newRole, "new");
            }}
          >
            <Field
              label="رقم المستخدم"
              htmlFor="team-user-id"
              required
              error={idError}
              hint="خذه من تبويب «المستخدمون»."
              className="sm:w-40"
            >
              <Input
                id="team-user-id"
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="User ID"
                inputMode="numeric"
                dir="ltr"
                aria-invalid={idError ? true : undefined}
                aria-describedby={describedBy("team-user-id", {
                  hint: true,
                  error: idError,
                })}
                className="tap-target h-10"
              />
            </Field>

            <Field label="الدور" htmlFor="team-role" className="sm:flex-1">
              <select
                id="team-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="admin-input focus-ring tap-target h-10 w-full text-sm"
              >
                {Object.entries(ROLE_AR).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Button
              type="submit"
              disabled={busyId === "new"}
              className="tap-target h-10 sm:mt-6"
            >
              {busyId === "new" ? <Spinner /> : <UserPlus className="size-4" />}
              ترقية
            </Button>
          </form>
        </AdminCardBody>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader
          title="المشرفون الحاليون"
          description={`${rows.length} حساب لديه صلاحية إشراف`}
        />

        <div className="space-y-2 p-3 sm:hidden">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              لا يوجد مشرفون غير المالك.
            </p>
          ) : (
            rows.map((row, i) => (
              <RecordCard
                key={row.user_id}
                index={i}
                title={row.email}
                subtitle={`#${row.user_id}`}
                badge={
                  <Badge variant="secondary">
                    {ROLE_AR[row.admin_role ?? "owner"] ?? row.admin_role}
                  </Badge>
                }
                fields={[
                  {
                    label: "الدور",
                    value: (
                      <select
                        aria-label={`دور ${row.email}`}
                        value={row.admin_role ?? "owner"}
                        onChange={(e) => void assign(row.user_id, e.target.value)}
                        className="admin-input focus-ring tap-target h-10 w-full text-xs"
                      >
                        {Object.entries(ROLE_AR).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ),
                  },
                ]}
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    className="tap-target"
                    disabled={busyId === row.user_id}
                    onClick={() => void assign(row.user_id, null)}
                  >
                    {busyId === row.user_id ? <Spinner /> : null}
                    إزالة الإشراف
                  </Button>
                }
              />
            ))
          )}
        </div>

        <TableWrap className="hidden sm:block">
          <AdminTable className="min-w-[34rem]">
            <caption className="sr-only">قائمة المشرفين وأدوارهم</caption>
            <THead>
              <tr>
                <Th>المشرف</Th>
                <Th>الدور</Th>
                <Th className="text-end">إجراءات</Th>
              </tr>
            </THead>
            <tbody>
              {rows.length === 0 ? (
                <TableEmptyRow
                  colSpan={3}
                  icon={ShieldCheck}
                  title="لا يوجد مشرفون بعد"
                  description="رقِّ مستخدماً من النموذج أعلاه ليظهر هنا بدوره ونطاق صلاحياته."
                />
              ) : (
                rows.map((row) => (
                  <Tr key={row.user_id}>
                    <Td>
                      <span className="text-foreground" dir="ltr">
                        {row.email}
                      </span>{" "}
                      <span className="type-numeric text-[10px] text-muted-foreground">
                        #{row.user_id}
                      </span>
                    </Td>
                    <Td>
                      <select
                        aria-label={`دور ${row.email}`}
                        value={row.admin_role ?? "owner"}
                        onChange={(e) => void assign(row.user_id, e.target.value)}
                        className="admin-input focus-ring h-9 w-full min-w-44 text-xs"
                      >
                        {Object.entries(ROLE_AR).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="tap-target"
                          disabled={busyId === row.user_id}
                          onClick={() => void assign(row.user_id, null)}
                        >
                          {busyId === row.user_id ? <Spinner /> : null}
                          إزالة الإشراف
                        </Button>
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
