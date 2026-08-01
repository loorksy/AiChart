"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/squareui/button";
import { StatTilesSkeleton } from "@/components/ui/skeletons/page-skeletons";
import type { AdminPermission } from "@/lib/adminRoles";
import type {
  AdminOverviewUserRow,
  DashboardPeriod,
  OverviewKpis,
  OverviewLeader,
  OverviewSeriesPoint,
} from "@/lib/admin/overviewQueries";
import { Lock } from "lucide-react";
import {
  AdminPage,
  EmptyState,
  SectionHeader,
} from "@/components/admin/ui/AdminKit";
import { DashboardProfitChart } from "./DashboardProfitChart";
import { DashboardStatsCards } from "./DashboardStatsCards";
import { DashboardTopUsers } from "./DashboardTopUsers";
import { DashboardUsersTable } from "./DashboardUsersTable";
import { useAdminDashboardStore } from "./dashboardStore";
import { formatDateCompact, formatTime } from "./format";

/**
 * The نظرة عامة tab: KPIs, the revenue/cost series, the revenue leaderboard and
 * the money-per-user roster. This component owns both fetches; the four
 * presentational children receive plain data and never call the network.
 *
 * The response shapes are declared here rather than imported from the route
 * modules — pulling a type out of `app/api/**` would drag a server-only module
 * graph into the client bundle's import list for no benefit. They mirror the
 * agreed contract and are built from the shared `overviewQueries` types, so a
 * drift in either row type is still a compile error.
 */

const PERIODS: DashboardPeriod[] = [7, 30, 90];

interface AdminOverviewResponse {
  ok: true;
  days: DashboardPeriod;
  /** epoch ms, half-open [from, to) */
  range: { from: number; to: number };
  permissions: AdminPermission[];
  kpis: OverviewKpis | null;
  series: OverviewSeriesPoint[];
  leaders: OverviewLeader[];
}

interface AdminOverviewUsersResponse {
  ok: true;
  rows: AdminOverviewUserRow[];
  money_visible: boolean;
  profit_visible: boolean;
}

/** A settled fetch. `null` in the state slots below is the loading case. */
type Load<T> =
  | { status: "ready"; data: T }
  | { status: "forbidden" }
  | { status: "error"; message: string };

/**
 * A 403 is not an error to shout about — it is this admin role simply not
 * covering that section, and the caller hides the card instead of rendering a
 * scary empty state. Aborts are rethrown so a superseded request stays silent.
 */
async function loadJson<T>(url: string, signal: AbortSignal): Promise<Load<T>> {
  let res: Response;
  try {
    res = await fetch(url, { signal, cache: "no-store" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { status: "error", message: "تعذّر الاتصال بالخادم." };
  }
  if (res.status === 401 || res.status === 403) return { status: "forbidden" };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: "error", message: body.error ?? "تعذّر تحميل البيانات." };
  }
  try {
    return { status: "ready", data: (await res.json()) as T };
  } catch {
    return { status: "error", message: "وصل ردّ غير مفهوم من الخادم." };
  }
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center"
    >
      <p className="text-sm text-foreground">{message}</p>
      <Button
        variant="outline"
        size="sm"
        className="tap-target mt-3"
        onClick={onRetry}
      >
        إعادة المحاولة
      </Button>
    </div>
  );
}

export function PlatformDashboard({
  permissions,
}: {
  adminId: number;
  permissions: AdminPermission[];
}) {
  const period = useAdminDashboardStore((s) => s.period);
  const setPeriod = useAdminDashboardStore((s) => s.setPeriod);

  const canReadUsers = permissions.includes("users_read");

  // The overview payload is tagged with the window it was fetched for. Switching
  // period invalidates it by comparison rather than by resetting state inside
  // the effect, which would cost an extra render pass on every change.
  const [overview, setOverview] = useState<
    { period: DashboardPeriod; load: Load<AdminOverviewResponse> } | null
  >(null);
  const [users, setUsers] = useState<Load<AdminOverviewUsersResponse> | null>(
    canReadUsers ? null : { status: "forbidden" },
  );
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const retry = useCallback(() => {
    setOverview(null);
    if (canReadUsers) setUsers(null);
    setReloadToken((t) => t + 1);
  }, [canReadUsers]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const load = await loadJson<AdminOverviewResponse>(
          `/api/admin/overview?days=${period}`,
          controller.signal,
        );
        setOverview({ period, load });
        if (load.status === "ready") setFetchedAt(Date.now());
      } catch {
        // Superseded by a newer period — the newer request owns the state now.
      }
    })();
    return () => controller.abort();
  }, [period, reloadToken]);

  // The roster is window-independent, so it is fetched once rather than on
  // every period change.
  useEffect(() => {
    if (!canReadUsers) return;
    const controller = new AbortController();
    void (async () => {
      try {
        setUsers(
          await loadJson<AdminOverviewUsersResponse>(
            "/api/admin/overview/users",
            controller.signal,
          ),
        );
      } catch {
        // Aborted on unmount.
      }
    })();
    return () => controller.abort();
  }, [canReadUsers, reloadToken]);

  const overviewLoad = overview && overview.period === period ? overview.load : null;
  const overviewLoading = overviewLoad === null;
  const overviewData = overviewLoad?.status === "ready" ? overviewLoad.data : null;
  const usersData = users?.status === "ready" ? users.data : null;

  // The response is the authority on permissions; the prop only decides whether
  // a request worth making is made at all.
  const profitVisible = overviewData
    ? overviewData.permissions.includes("profit_read")
    : permissions.includes("profit_read");
  const billingVisible = overviewData
    ? overviewData.permissions.includes("billing_read")
    : permissions.includes("billing_read");

  // A failed window already has its own error card — the cards below would only
  // repeat it as four empty tiles and a chart claiming there was no activity.
  const showProfitBlock =
    profitVisible && overviewLoad?.status !== "forbidden" && overviewLoad?.status !== "error";
  const showUsersBlock = users?.status !== "forbidden";
  // "Nothing here" only when nothing was *allowed*, never when something broke.
  const nothingPermitted =
    overviewLoad?.status !== "error" &&
    users?.status !== "error" &&
    !showProfitBlock &&
    !showUsersBlock;

  const rangeLabel = overviewData
    ? `${formatDateCompact(overviewData.range.from)} — ${formatDateCompact(overviewData.range.to - 1)}`
    : null;

  return (
    <AdminPage dir="rtl" data-testid="admin-overview-panel">
      <SectionHeader
        title="نظرة عامة"
        description={
          overviewLoading
            ? "جارٍ تحميل بيانات المنصة…"
            : rangeLabel
              ? `آخر ${period} يوم · ${rangeLabel}${
                  fetchedAt ? ` · آخر تحديث ${formatTime(fetchedAt)}` : ""
                }`
              : `آخر ${period} يوم`
        }
        actions={
          <div
            role="group"
            aria-label="نافذة التقرير"
            className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5"
          >
            {PERIODS.map((p) => (
              <Button
                key={p}
                variant={period === p ? "secondary" : "ghost"}
                size="sm"
                className="tap-target h-7 px-2.5 transition-colors duration-150 ease-out"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
              >
                {p} يوم
              </Button>
            ))}
          </div>
        }
      />

      {overviewLoad?.status === "error" && (
        <ErrorCard message={overviewLoad.message} onRetry={retry} />
      )}

      {showProfitBlock && (
        <>
          {overviewLoading ? (
            <StatTilesSkeleton count={4} />
          ) : (
            <DashboardStatsCards
              kpis={overviewData?.kpis ?? null}
              billingVisible={billingVisible}
            />
          )}

          <div className="flex flex-col gap-4 lg:flex-row">
            <DashboardProfitChart
              series={overviewData?.series ?? []}
              loading={overviewLoading}
              className="flex-1"
            />
            <DashboardTopUsers
              leaders={overviewData?.leaders ?? []}
              loading={overviewLoading}
            />
          </div>
        </>
      )}

      {showUsersBlock &&
        (users?.status === "error" ? (
          <ErrorCard message={users.message} onRetry={retry} />
        ) : (
          <DashboardUsersTable
            rows={usersData?.rows ?? []}
            moneyVisible={usersData?.money_visible ?? false}
            profitVisible={usersData?.profit_visible ?? false}
            loading={users === null}
          />
        ))}

      {nothingPermitted && (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={Lock}
            title="لا صلاحية لعرض هذه النظرة"
            description="دورك الحالي لا يغطي أي قسم في هذه الصفحة. راجع مالك الحساب لتوسيع الصلاحيات."
          />
        </div>
      )}
    </AdminPage>
  );
}
