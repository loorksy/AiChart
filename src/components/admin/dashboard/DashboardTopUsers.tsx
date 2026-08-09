"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Award01Icon,
  MoreHorizontalIcon,
  StarIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Avatar, AvatarFallback } from "@/components/squareui/avatar";
import { Button } from "@/components/squareui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/squareui/dropdown-menu";
import { EmptyState } from "@/components/admin/ui/AdminKit";
import { SkeletonBlock, SkeletonCircle } from "@/components/ui/skeleton";
import type { OverviewLeader } from "@/lib/admin/overviewQueries";
import { cn } from "@/lib/utils";
import { useAdminDashboardStore, type LeaderMetric } from "./dashboardStore";
import { formatInt, formatUsd, initialFor } from "./format";

/**
 * Revenue leaderboard for the selected window.
 *
 * The bar always measures REVENUE against the window's top earner; the metric
 * toggle only re-orders the same eight rows. Rescaling the bar per mode would
 * make two screenshots of the same data look like different numbers.
 *
 * Rank colours come from the product's --chart-* scale — the same palette the
 * revenue chart next to this card draws with — so the two money views read as
 * one system. Borders are solid: the dash pattern encoded nothing.
 */

const BAR_STYLES = [
  {
    border: "border-chart-1",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-chart-1/40 via-chart-1/20 to-transparent",
  },
  {
    border: "border-chart-2",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-chart-2/30 via-chart-2/15 to-transparent",
  },
  {
    border: "border-chart-3",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-chart-3/30 via-chart-3/15 to-transparent",
  },
  {
    border: "border-chart-4",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-chart-4/30 via-chart-4/15 to-transparent",
  },
  {
    border: "border-chart-5",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-chart-5/30 via-chart-5/15 to-transparent",
  },
] as const;

function LeaderRow({ leader, rank, share }: { leader: OverviewLeader; rank: number; share: number }) {
  const style = BAR_STYLES[rank % BAR_STYLES.length];
  const isFirst = rank === 0;

  return (
    <div className="flex items-center gap-3">
      <Avatar size="lg">
        <AvatarFallback className="text-sm font-medium">
          {initialFor(leader.email)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "relative h-[42px] overflow-hidden rounded-lg border border-solid",
            style.border,
          )}
        >
          <div
            className={cn("absolute inset-y-0 start-0 transition-all duration-300", style.fill)}
            style={{ width: `${share}%` }}
          />
          <div className="absolute inset-y-0 start-2 end-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 shadow-sm">
              <HugeiconsIcon
                icon={isFirst ? StarIcon : UserIcon}
                className={cn(
                  "size-3.5 shrink-0",
                  isFirst ? "text-warning" : "text-muted-foreground",
                )}
              />
              <span
                dir="ltr"
                title={leader.email}
                className={cn(
                  "truncate text-xs",
                  isFirst ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {leader.email}
              </span>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums" dir="ltr">
              {formatUsd(leader.revenue_usd)}
            </span>
          </div>
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          <span>صافي</span>
          <span
            dir="ltr"
            className={cn(
              "tabular-nums",
              leader.profit_usd < 0 ? "text-sell" : "text-buy",
            )}
          >
            {formatUsd(leader.profit_usd)}
          </span>
          <span aria-hidden="true">·</span>
          <span>تكلفة</span>
          <span dir="ltr" className="tabular-nums">
            {formatUsd(leader.provider_cost_usd)}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatInt(leader.events)} طلب</span>
        </p>
      </div>
    </div>
  );
}

export function DashboardTopUsers({
  leaders,
  loading,
  className,
}: {
  leaders: OverviewLeader[];
  loading: boolean;
  className?: string;
}) {
  const leaderMetric = useAdminDashboardStore((s) => s.leaderMetric);
  const setLeaderMetric = useAdminDashboardStore((s) => s.setLeaderMetric);

  const ordered = useMemo(() => {
    const copy = [...leaders];
    return leaderMetric === "revenue"
      ? copy.sort((a, b) => b.revenue_usd - a.revenue_usd)
      : copy.sort((a, b) => a.profit_usd - b.profit_usd);
  }, [leaders, leaderMetric]);

  const maxRevenue = useMemo(
    () => leaders.reduce((max, l) => Math.max(max, l.revenue_usd), 0),
    [leaders],
  );

  return (
    <div
      className={cn(
        "elevation-1 w-full shrink-0 rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground lg:w-[360px]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="min-w-0">
          <h3 className="type-subheading">أعلى المستخدمين</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {leaderMetric === "revenue"
              ? "مرتّبون حسب الإيراد"
              : "مرتّبون حسب الخسارة (الأقل ربحاً أولاً)"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <HugeiconsIcon icon={Award01Icon} className="size-4 text-muted-foreground" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="tap-target-expand"
                  aria-label="خيارات الترتيب"
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              {/* Labels name what actually happens: the bar measures revenue,
                  so the first ordering is "most revenue", not "most profit". */}
              <DropdownMenuRadioGroup
                value={leaderMetric}
                onValueChange={(value) => setLeaderMetric(value as LeaderMetric)}
              >
                <DropdownMenuRadioItem value="revenue">
                  الأكثر إيراداً
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="loss">
                  الأكثر خسارة
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <SkeletonCircle size="md" />
              <SkeletonBlock className="h-[42px] flex-1 rounded-lg" />
            </div>
          ))
        ) : ordered.length === 0 ? (
          <EmptyState
            title="لا ترتيب بعد"
            description="لا توجد بيانات كافية لترتيب المستخدمين في هذه الفترة."
            className="py-8"
          />
        ) : (
          ordered.map((leader, index) => (
            <LeaderRow
              key={leader.user_id}
              leader={leader}
              rank={index}
              share={
                maxRevenue > 0
                  ? Math.min(100, Math.max(0, (leader.revenue_usd / maxRevenue) * 100))
                  : 0
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
