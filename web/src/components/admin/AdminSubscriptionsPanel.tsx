"use client";

import { useCallback, useState } from "react";
import { CreditCard, Search, UserSearch } from "lucide-react";

import { AICHART_PLAN } from "@/lib/subscription/plan";
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
  SectionHeader,
  Spinner,
  THead,
  Td,
  Th,
  TableEmptyRow,
  TableSkeletonRows,
  TableWrap,
  Tr,
} from "@/components/admin/ui/AdminKit";

type SubRow = {
  user_id: number;
  email: string;
  role: string;
  status: string;
  plan_status: string;
  trial_interactions_used: number;
  subscription_expires_at: string | null;
  note: string | null;
};

type SubAction = "activate" | "suspend" | "restore_trial";

const ACTIONS: { id: SubAction; label: string }[] = [
  { id: "activate", label: "تفعيل" },
  { id: "suspend", label: "إيقاف" },
  { id: "restore_trial", label: "تجربة" },
];

const PLAN_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  trial: "secondary",
  expired: "destructive",
  suspended: "destructive",
};

export function AdminSubscriptionsPanel() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SubRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const res = await fetch(
        `/api/admin/subscriptions?q=${encodeURIComponent(q.trim())}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setRows(data.users ?? []);
      setSearched(true);
    } catch (e) {
      setFailed(true);
      setMessage(
        e instanceof Error && e.message !== "Search failed"
          ? e.message
          : "تعذّر البحث — تأكّد من الاتصال ثم أعد المحاولة.",
      );
    } finally {
      setBusy(false);
    }
  }, [q]);

  async function mutate(userId: number, action: SubAction, expiresAt?: string) {
    setBusy(true);
    setBusyRow(userId);
    setMessage(null);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/subscriptions/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expiresAt: expiresAt || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setMessage("تم التحديث");
      await search();
    } catch (e) {
      setFailed(true);
      setMessage(
        e instanceof Error && e.message !== "Update failed"
          ? e.message
          : "فشل التحديث — لم تتغيّر حالة الاشتراك. أعد المحاولة.",
      );
    } finally {
      setBusy(false);
      setBusyRow(null);
    }
  }

  function actionButtons(r: SubRow) {
    return ACTIONS.map((a) => (
      <Button
        key={a.id}
        type="button"
        variant="outline"
        size="sm"
        className="tap-target"
        disabled={busy || r.role === "admin"}
        title={
          r.role === "admin"
            ? "حساب مشرف — اشتراكه لا يُدار من هنا"
            : undefined
        }
        onClick={() => void mutate(r.user_id, a.id)}
      >
        {busyRow === r.user_id ? <Spinner /> : null}
        {a.label}
      </Button>
    ));
  }

  return (
    <AdminPage dir="rtl" data-testid="admin-subscriptions-panel">
      <SectionHeader
        title="إدارة الاشتراكات"
        description={`خطة واحدة: ${AICHART_PLAN.titleAr} — ${AICHART_PLAN.promotionalPriceUsd}$ (بدلاً من ${AICHART_PLAN.regularPriceUsd}$) · تفعيل يدوي بعد الدفع عبر Telegram`}
        icon={CreditCard}
      />

      {message && <InlineAlert tone={failed ? "error" : "ok"}>{message}</InlineAlert>}

      <AdminCard>
        <AdminCardHeader
          title="بحث عن حساب"
          description="ابحث بالبريد للوصول إلى اشتراك العميل."
        >
          <form
            className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <Search
                aria-hidden
                className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث بالبريد…"
                aria-label="بحث عن مشترك بالبريد"
                className="tap-target h-10 ps-8 text-sm"
              />
            </div>
            <Button type="submit" className="tap-target h-10" disabled={busy}>
              {busy && busyRow === null ? <Spinner /> : null}
              بحث
            </Button>
          </form>
        </AdminCardHeader>

        <div className="space-y-2 p-3 sm:hidden">
          {busy && busyRow === null ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              جارٍ البحث…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {searched
                ? "لا يوجد حساب مطابق لهذا البريد."
                : "ابحث عن مستخدم لإدارة اشتراكه."}
            </p>
          ) : (
            rows.map((r, i) => (
              <RecordCard
                key={r.user_id}
                index={i}
                title={r.email}
                subtitle={`#${r.user_id}`}
                badge={
                  <Badge variant={PLAN_VARIANT[r.plan_status] ?? "outline"}>
                    {r.plan_status}
                  </Badge>
                }
                fields={[
                  {
                    label: "التجربة",
                    value: (
                      <span dir="ltr" className="type-numeric">
                        {r.trial_interactions_used}/{AICHART_PLAN.trialInteractions}
                      </span>
                    ),
                  },
                  {
                    label: "الانتهاء",
                    value: r.subscription_expires_at
                      ? new Date(r.subscription_expires_at).toLocaleDateString()
                      : "—",
                  },
                ]}
                actions={actionButtons(r)}
              />
            ))
          )}
        </div>

        <TableWrap className="hidden sm:block" maxHeight="max-h-[32rem]">
          <AdminTable className="min-w-[40rem]">
            <caption className="sr-only">نتائج البحث عن المشتركين</caption>
            <THead sticky>
              <tr>
                <Th>المستخدم</Th>
                <Th>الحالة</Th>
                <Th>التجربة</Th>
                <Th>الانتهاء</Th>
                <Th className="text-end">إجراءات</Th>
              </tr>
            </THead>
            <tbody>
              {busy && busyRow === null ? (
                <TableSkeletonRows rows={3} cols={5} />
              ) : rows.length === 0 ? (
                <TableEmptyRow
                  colSpan={5}
                  icon={UserSearch}
                  title={
                    searched
                      ? "لا يوجد حساب مطابق"
                      : "ابحث عن مستخدم لإدارة اشتراكه"
                  }
                  description={
                    searched
                      ? "جرّب بريداً آخر — البحث يطابق البريد الكامل أو جزءاً منه."
                      : "اكتب بريد العميل في المربع أعلاه ثم اضغط بحث."
                  }
                />
              ) : (
                rows.map((r) => (
                  <Tr key={r.user_id}>
                    <Td>
                      <div className="text-start" dir="ltr">
                        <p className="font-medium text-foreground">{r.email}</p>
                        <p className="type-numeric text-[11px] text-muted-foreground">
                          #{r.user_id}
                        </p>
                      </div>
                    </Td>
                    <Td>
                      <Badge variant={PLAN_VARIANT[r.plan_status] ?? "outline"}>
                        {r.plan_status}
                      </Badge>
                    </Td>
                    <Td numeric dir="ltr">
                      {r.trial_interactions_used}/{AICHART_PLAN.trialInteractions}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.subscription_expires_at
                        ? new Date(r.subscription_expires_at).toLocaleDateString()
                        : "—"}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {actionButtons(r)}
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
