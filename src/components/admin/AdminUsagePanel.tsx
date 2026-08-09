"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Cpu, Users } from "lucide-react";

import type { ClaudeUsageRow } from "@/lib/store";
import { Badge } from "@/components/squareui/badge";
import { cn } from "@/lib/utils";
import {
  AdminCard,
  AdminCardHeader,
  AdminPage,
  AdminTable,
  RecordCard,
  SectionHeader,
  SortTh,
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

/** `natural` = the order the API returned. */
type UsageSortKey = "natural" | "email" | "used" | "quota" | "pct";

function statusAr(status: string) {
  if (status === "active") return "مفعّل";
  if (status === "pending") return "معلّق";
  if (status === "suspended") return "موقوف";
  return status;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "active") return "default";
  if (status === "pending") return "secondary";
  return "destructive";
}

function usagePct(row: ClaudeUsageRow): number {
  return row.quota > 0 ? Math.round((row.used_today / row.quota) * 100) : 0;
}

/**
 * The consumption bar. It is a plain block in normal flow, so it grows from the
 * inline start and mirrors with the document direction for free — an absolutely
 * positioned fill would have had to be flipped by hand in Arabic.
 */
function UsageBar({ pct, hot }: { pct: number; hot: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="نسبة الاستهلاك من الحصة اليومية"
        className="relative h-1.5 w-24 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
            hot ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span
        dir="ltr"
        className={cn(
          "type-numeric text-xs font-semibold",
          hot ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {pct}%
      </span>
    </div>
  );
}

export function AdminUsagePanel({
  initialUsage,
}: {
  initialUsage: ClaudeUsageRow[];
}) {
  const [usage, setUsage] = useState(initialUsage);
  const { key: sortKey, dir, sortProps } = useAdminSort<UsageSortKey>("natural");

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

  const totalCalls = usage.reduce((acc, curr) => acc + curr.used_today, 0);
  const totalQuota = usage.reduce((acc, curr) => acc + curr.quota, 0);
  const avgUsagePct = totalQuota > 0 ? Math.round((totalCalls / totalQuota) * 100) : 0;
  const hotAccounts = usage.filter((r) => usagePct(r) >= 90).length;

  const rows = useMemo(() => {
    if (sortKey === "natural") return usage;
    const sign = sortSign(dir);
    return [...usage].sort((a, b) => {
      switch (sortKey) {
        case "email":
          return sign * a.email.localeCompare(b.email, "en");
        case "used":
          return sign * (a.used_today - b.used_today);
        case "quota":
          return sign * (a.quota - b.quota);
        case "pct":
          return sign * (usagePct(a) - usagePct(b));
        default:
          return 0;
      }
    });
  }, [usage, sortKey, dir]);

  return (
    <AdminPage dir="rtl" data-testid="admin-usage-panel">
      <SectionHeader
        title="مراقبة استهلاك Claude"
        description="استهلاك كل مستخدم اليوم مقابل الحصة المحددة — لمنع استنزاف الرصيد. يُحدَّث كل ٣٠ ثانية."
        icon={Cpu}
        actions={
          hotAccounts > 0 ? (
            <Badge variant="destructive">{hotAccounts} حساب قارب الحصة</Badge>
          ) : null
        }
      />

      <StatGrid columns={3}>
        <StatTile
          index={0}
          icon={Activity}
          label="إجمالي الاستدعاءات اليوم"
          value={totalCalls.toLocaleString("en-US")}
        />
        <StatTile
          index={1}
          icon={Users}
          label="إجمالي الحصص اليومية"
          value={totalQuota.toLocaleString("en-US")}
        />
        <StatTile
          index={2}
          icon={BarChart3}
          label="معدل الاستهلاك العام"
          value={`${avgUsagePct}%`}
          tone={avgUsagePct >= 90 ? "negative" : "positive"}
        />
      </StatGrid>

      <AdminCard>
        <AdminCardHeader
          title="الاستهلاك لكل حساب"
          description={`${usage.length} حساب`}
        />

        <div className="space-y-2 p-3 sm:hidden">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              لا استهلاك مسجّل اليوم.
            </p>
          ) : (
            rows.map((row, i) => {
              const pct = usagePct(row);
              return (
                <RecordCard
                  key={row.user_id}
                  index={i}
                  title={row.email}
                  badge={
                    <Badge variant={statusVariant(row.status)}>
                      {statusAr(row.status)}
                    </Badge>
                  }
                  fields={[
                    { label: "الاستخدام اليوم", value: row.used_today },
                    { label: "الحصة", value: row.quota },
                    {
                      label: "النسبة",
                      value: <UsageBar pct={pct} hot={pct >= 90} />,
                    },
                  ]}
                />
              );
            })
          )}
        </div>

        <TableWrap className="hidden sm:block" maxHeight="max-h-[34rem]">
          <AdminTable className="min-w-[42rem]">
            <caption className="sr-only">
              استهلاك Claude اليومي لكل حساب مقابل حصته
            </caption>
            <THead sticky>
              <tr>
                <SortTh label="المستخدم" {...sortProps("email")} />
                <Th>الحالة</Th>
                <SortTh label="الاستخدام اليوم" numeric {...sortProps("used")} />
                <SortTh label="الحصة" numeric {...sortProps("quota")} />
                <SortTh label="النسبة" {...sortProps("pct")} />
              </tr>
            </THead>
            <tbody>
              {rows.length === 0 ? (
                <TableEmptyRow
                  colSpan={5}
                  icon={Cpu}
                  title="لا استهلاك مسجّل اليوم"
                  description="يظهر كل حساب هنا فور أول استدعاء له خلال اليوم الجاري."
                />
              ) : (
                rows.map((row) => {
                  const pct = usagePct(row);
                  const hot = pct >= 90;
                  return (
                    <Tr key={row.user_id}>
                      <Td className="font-medium text-foreground" dir="ltr">
                        <span className="block text-start">{row.email}</span>
                      </Td>
                      <Td>
                        <Badge variant={statusVariant(row.status)}>
                          {statusAr(row.status)}
                        </Badge>
                      </Td>
                      <Td numeric className="font-medium text-foreground">
                        {row.used_today}
                      </Td>
                      <Td numeric className="text-muted-foreground">
                        {row.quota}
                      </Td>
                      <Td>
                        <UsageBar pct={pct} hot={hot} />
                      </Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </AdminTable>
        </TableWrap>
      </AdminCard>
    </AdminPage>
  );
}
