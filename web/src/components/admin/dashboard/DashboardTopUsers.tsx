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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/squareui/dropdown-menu";
import { SkeletonBlock, SkeletonCircle } from "@/components/ui/skeleton";
import type { OverviewLeader } from "@/lib/admin/overviewQueries";
import { cn } from "@/lib/utils";
import { useAdminDashboardStore } from "./dashboardStore";
import { formatInt, formatUsd, initialFor } from "./format";

/**
 * Revenue leaderboard for the selected window.
 *
 * The bar always measures REVENUE against the window's top earner; the metric
 * toggle only re-orders the same eight rows. Rescaling the bar per mode would
 * make two screenshots of the same data look like different numbers.
 */

const BAR_STYLES = [
  {
    border: "border-pink-500",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-pink-500/40 via-pink-500/20 to-transparent",
    dashed: false,
  },
  {
    border: "border-cyan-400",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-cyan-400/30 via-cyan-400/15 to-transparent",
    dashed: true,
  },
  {
    border: "border-green-400",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-green-400/30 via-green-400/15 to-transparent",
    dashed: true,
  },
  {
    border: "border-amber-400",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-amber-400/30 via-amber-400/15 to-transparent",
    dashed: true,
  },
  {
    border: "border-purple-400",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-purple-400/30 via-purple-400/15 to-transparent",
    dashed: true,
  },
  {
    border: "border-rose-400",
    fill: "ltr:bg-linear-to-r rtl:bg-linear-to-l from-rose-400/30 via-rose-400/15 to-transparent",
    dashed: true,
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
            "relative h-[42px] overflow-hidden rounded-lg border",
            style.border,
            style.dashed ? "border-dashed" : "border-solid",
          )}
        >
          <div
            className={cn("absolute inset-y-0 start-0 transition-all duration-300", style.fill)}
            style={{ width: `${share}%` }}
          />
          <div className="absolute inset-y-0 start-2 end-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 shadow-sm dark:bg-neutral-900/90">
              <HugeiconsIcon
                icon={isFirst ? StarIcon : UserIcon}
                className={cn(
                  "size-3.5 shrink-0",
                  isFirst ? "text-amber-400" : "text-muted-foreground",
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
              leader.profit_usd < 0 ? "text-pink-400" : "text-foreground",
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
        "bg-card text-card-foreground w-full shrink-0 rounded-xl border lg:w-[360px]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/50 p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium sm:text-base">أعلى المستخدمين</h3>
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
                  size="icon"
                  className="size-7"
                  aria-label="خيارات الترتيب"
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setLeaderMetric("revenue")}>
                  الأكثر ربحاً {leaderMetric === "revenue" && "✓"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLeaderMetric("loss")}>
                  الأكثر خسارة {leaderMetric === "loss" && "✓"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
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
          <p className="py-8 text-center text-sm text-muted-foreground">
            لا توجد بيانات كافية لترتيب المستخدمين في هذه الفترة.
          </p>
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
