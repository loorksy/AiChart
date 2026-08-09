"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";

import { ADMIN_ACTION_LABELS } from "@/components/admin/adminNav";
import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import {
  AdminCard,
  AdminCardHeader,
  AdminPage,
  AdminTable,
  RecordCard,
  SectionHeader,
  SortTh,
  THead,
  Td,
  Th,
  TableEmptyRow,
  TableWrap,
  Tr,
  sortSign,
  useAdminSort,
} from "@/components/admin/ui/AdminKit";

type AuditRow = {
  id: number;
  user_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
};

/** `natural` preserves the order the query returned until a column is picked. */
type AuditSortKey = "natural" | "time" | "action" | "user";

const SECURITY_ACTIONS = new Set(["injection_blocked", "trade_execute"]);

function actionLabel(action: string): string {
  return ADMIN_ACTION_LABELS[action] ?? action;
}

export function AdminSecurityPanel({
  audit,
  securityOnly = false,
}: {
  audit: AuditRow[];
  securityOnly?: boolean;
}) {
  const [search, setSearch] = useState("");
  const { key: sortKey, dir, sortProps } = useAdminSort<AuditSortKey>("natural");

  const rows = useMemo(
    () =>
      securityOnly ? audit.filter((a) => SECURITY_ACTIONS.has(a.action)) : audit,
    [audit, securityOnly],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.action.toLowerCase().includes(needle) ||
            actionLabel(r.action).toLowerCase().includes(needle) ||
            (r.detail ?? "").toLowerCase().includes(needle) ||
            String(r.user_id ?? "").includes(needle),
        )
      : rows;
    if (sortKey === "natural") return filtered;
    const sign = sortSign(dir);
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        // ISO-8601 sorts correctly as text, so no Date allocation per compare.
        case "time":
          return sign * a.created_at.localeCompare(b.created_at, "en");
        case "action":
          return sign * actionLabel(a.action).localeCompare(actionLabel(b.action), "ar");
        case "user":
          return sign * ((a.user_id ?? 0) - (b.user_id ?? 0));
        default:
          return 0;
      }
    });
  }, [rows, search, sortKey, dir]);

  const blocked = useMemo(
    () => rows.filter((r) => r.action === "injection_blocked").length,
    [rows],
  );

  return (
    <AdminPage dir="rtl" data-testid="admin-security-panel">
      <SectionHeader
        title={securityOnly ? "الأمن" : "سجل التدقيق"}
        description={
          securityOnly
            ? "محاولات حقن برومبت ونشاط مريب."
            : "كل قرار وصفقة وحدث مهم مع السبب والزمن."
        }
        actions={
          blocked > 0 ? (
            <Badge variant="destructive">
              {blocked} محاولة حقن محجوبة
            </Badge>
          ) : (
            <Badge variant="secondary">لا محاولات حقن مسجّلة</Badge>
          )
        }
      />

      <AdminCard>
        <AdminCardHeader
          title={`${visible.length} حدث`}
          description="أحدث الأحداث أولاً ما لم تغيّر الترتيب من رأس العمود."
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
                placeholder="بحث في الإجراء أو التفاصيل"
                aria-label="بحث في سجل التدقيق"
                className="tap-target h-9 ps-8 text-sm"
              />
            </div>
          }
        />

        <div className="space-y-2 p-3 sm:hidden">
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? "لا توجد أحداث مسجّلة بعد."
                : "لا يوجد حدث مطابق للبحث."}
            </p>
          ) : (
            visible.map((row, i) => (
              <RecordCard
                key={row.id}
                index={i}
                title={actionLabel(row.action)}
                subtitle={row.created_at.slice(0, 16).replace("T", " ")}
                badge={
                  row.action === "injection_blocked" ? (
                    <Badge variant="destructive">محجوب</Badge>
                  ) : null
                }
                fields={[
                  { label: "المستخدم", value: row.user_id ?? "—" },
                  { label: "التفاصيل", value: row.detail ?? "—" },
                ]}
              />
            ))
          )}
        </div>

        <TableWrap className="hidden sm:block" maxHeight="max-h-[38rem]">
          <AdminTable className="min-w-[44rem]">
            <caption className="sr-only">سجل أحداث المنصة</caption>
            <THead sticky>
              <tr>
                <SortTh label="الوقت" {...sortProps("time")} />
                <SortTh label="الإجراء" {...sortProps("action")} />
                <SortTh label="المستخدم" {...sortProps("user")} />
                <Th>التفاصيل</Th>
              </tr>
            </THead>
            <tbody>
              {visible.length === 0 ? (
                <TableEmptyRow
                  colSpan={4}
                  icon={rows.length > 0 ? Search : ShieldCheck}
                  title={
                    rows.length > 0
                      ? "لا يوجد حدث مطابق للبحث"
                      : "لا توجد أحداث مسجّلة بعد"
                  }
                  description={
                    rows.length > 0
                      ? "جرّب كلمة أخرى، أو امسح مربع البحث."
                      : "كل قرار وتنفيذ ومحاولة حقن سيظهر هنا فور وقوعه."
                  }
                  action={
                    rows.length > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                        مسح البحث
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                visible.map((row) => (
                  <Tr
                    key={row.id}
                    className={
                      row.action === "injection_blocked"
                        ? "bg-destructive/[0.06]"
                        : undefined
                    }
                  >
                    <Td className="type-numeric whitespace-nowrap text-xs text-muted-foreground" dir="ltr">
                      {row.created_at.slice(0, 16).replace("T", " ")}
                    </Td>
                    <Td>
                      <Badge
                        variant={
                          row.action === "injection_blocked" ? "destructive" : "secondary"
                        }
                      >
                        {actionLabel(row.action)}
                      </Badge>
                    </Td>
                    <Td className="type-numeric text-muted-foreground" dir="ltr">
                      {row.user_id ?? "—"}
                    </Td>
                    <Td className="max-w-md truncate text-xs text-muted-foreground">
                      <span title={row.detail ?? undefined}>{row.detail ?? "—"}</span>
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
