"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/squareui/button";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/squareui/chart";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/squareui/dropdown-menu";
import { EmptyState } from "@/components/admin/ui/AdminKit";
import { SkeletonBlock } from "@/components/ui/skeleton";
import type { OverviewSeriesPoint } from "@/lib/admin/overviewQueries";
import { cn } from "@/lib/utils";
import {
  useAdminDashboardStore,
  type ChartKind,
  type SeriesKey,
} from "./dashboardStore";
import { formatDayLabel, formatDayTick, formatUsd, formatUsdCompact } from "./format";

/**
 * Daily revenue / provider cost / net profit for the selected window.
 *
 * The window itself is owned by the page-level 7/30/90 segmented control in
 * PlatformDashboard's SectionHeader — this card deliberately carries no second
 * period picker.
 *
 * Colours come from the product's own --chart-* tokens rather than a `useTheme()`
 * read: an SVG `stroke="var(--chart-1)"` re-resolves the moment the `dark` class
 * flips, so the chart follows the theme with no re-render and no risk of a
 * server/client mismatch on first paint.
 */

const SERIES_META: { key: SeriesKey; label: string; color: string }[] = [
  { key: "revenue", label: "الإيراد", color: "var(--chart-1)" },
  { key: "cost", label: "التكلفة", color: "var(--chart-5)" },
  { key: "profit", label: "صافي الربح", color: "var(--chart-3)" },
];

const CHART_CONFIG: ChartConfig = {
  revenue: { label: "الإيراد", color: "var(--chart-1)" },
  cost: { label: "التكلفة", color: "var(--chart-5)" },
  profit: { label: "صافي الربح", color: "var(--chart-3)" },
};

interface MoneyTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    dataKey?: string | number;
    value?: number;
    color?: string;
  }>;
}

function MoneyTooltip({ active, payload, label }: MoneyTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-card p-3 shadow-lg" dir="rtl">
      <p className="mb-2 text-xs text-muted-foreground">
        {typeof label === "string" ? formatDayLabel(label) : label}
      </p>
      <div className="grid gap-1">
        {payload.map((entry) => {
          const meta = SERIES_META.find((s) => s.key === entry.dataKey);
          return (
            <div key={String(entry.dataKey)} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-xs text-muted-foreground">
                {meta?.label ?? String(entry.dataKey)}
              </span>
              <span className="ms-auto text-xs font-medium tabular-nums" dir="ltr">
                {formatUsd(entry.value ?? null)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardProfitChart({
  series,
  loading,
  className,
}: {
  series: OverviewSeriesPoint[];
  loading: boolean;
  className?: string;
}) {
  const chartKind = useAdminDashboardStore((s) => s.chartKind);
  const setChartKind = useAdminDashboardStore((s) => s.setChartKind);
  const showGrid = useAdminDashboardStore((s) => s.showGrid);
  const toggleGrid = useAdminDashboardStore((s) => s.toggleGrid);
  const visibleSeries = useAdminDashboardStore((s) => s.visibleSeries);
  const toggleSeries = useAdminDashboardStore((s) => s.toggleSeries);

  // A window with no money movement at all is a real answer, not a failure —
  // an axis pair drawn around nothing would only look broken.
  const hasData = useMemo(
    () => series.some((p) => p.revenue !== 0 || p.cost !== 0 || p.profit !== 0),
    [series],
  );

  const shown = SERIES_META.filter((s) => visibleSeries[s.key]);

  function resetToDefault() {
    setChartKind("area");
    if (!showGrid) toggleGrid();
    for (const s of SERIES_META) {
      if (!visibleSeries[s.key]) toggleSeries(s.key);
    }
  }

  return (
    <div
      className={cn(
        "elevation-1 flex min-w-0 flex-col rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h3 className="type-subheading">الإيراد مقابل التكلفة</h3>
          <div className="flex flex-wrap items-center gap-3">
            {SERIES_META.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSeries(s.key)}
                aria-pressed={visibleSeries[s.key]}
                className={cn(
                  "focus-ring tap-target-expand flex items-center gap-1.5 rounded text-xs transition-colors duration-150 ease-out",
                  visibleSeries[s.key]
                    ? "text-foreground"
                    : "text-muted-foreground/60 line-through",
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor: visibleSeries[s.key] ? s.color : "var(--border)",
                  }}
                />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="tap-target-expand"
                  aria-label="إعدادات الرسم"
                >
                  <HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>نوع الرسم</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={chartKind}
                    onValueChange={(value) => setChartKind(value as ChartKind)}
                  >
                    <DropdownMenuRadioItem value="line">خطي</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="area">مساحي</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={toggleGrid}>
                إظهار الشبكة
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>السلاسل</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuGroup>
                    {SERIES_META.map((s) => (
                      <DropdownMenuCheckboxItem
                        key={s.key}
                        checked={visibleSeries[s.key]}
                        onCheckedChange={() => toggleSeries(s.key)}
                      >
                        <span
                          className="me-2 size-2 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={resetToDefault}>
                إعادة الضبط الافتراضي
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <SkeletonBlock className="h-[280px] w-full rounded-lg" />
        ) : !hasData ? (
          <div className="flex h-[280px] items-center justify-center">
            <EmptyState
              title="لا توجد حركة مالية خلال هذه الفترة"
              description="جرّب توسيع الفترة إلى 90 يوماً."
              className="py-0"
            />
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              كل السلاسل مخفية — أعِد تفعيل واحدة على الأقل.
            </p>
          </div>
        ) : (
          // The chart itself stays LTR: recharts lays its axes out physically,
          // and a mirrored time axis would read right-to-left through the days.
          <div dir="ltr" className="min-w-0">
            <ChartContainer config={CHART_CONFIG} className="h-[280px] w-full">
              {chartKind === "area" ? (
                <AreaChart
                  data={series}
                  margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
                >
                  {showGrid && (
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                      vertical={false}
                    />
                  )}
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                    tick={{ fontSize: 10 }}
                    tickFormatter={formatDayTick}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value: number) => formatUsdCompact(value)}
                  />
                  <ChartTooltip content={<MoneyTooltip />} />
                  <defs>
                    {SERIES_META.map((s) => (
                      <linearGradient
                        key={s.key}
                        id={`admin-overview-gradient-${s.key}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  {shown.map((s) => (
                    <Area
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      stroke={s.color}
                      strokeWidth={2}
                      fill={`url(#admin-overview-gradient-${s.key})`}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  ))}
                </AreaChart>
              ) : (
                <LineChart
                  data={series}
                  margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
                >
                  {showGrid && (
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                      vertical={false}
                    />
                  )}
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                    tick={{ fontSize: 10 }}
                    tickFormatter={formatDayTick}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value: number) => formatUsdCompact(value)}
                  />
                  <ChartTooltip content={<MoneyTooltip />} />
                  {shown.map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  ))}
                </LineChart>
              )}
            </ChartContainer>
          </div>
        )}
      </div>
    </div>
  );
}
