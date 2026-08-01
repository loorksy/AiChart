"use client";

import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowDownRight01Icon,
  ArrowUpRight01Icon,
  CoinsDollarIcon,
  InformationCircleIcon,
  MoneyBag02Icon,
  ServerStack01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/squareui/tooltip";
import type { OverviewDelta, OverviewKpis } from "@/lib/admin/overviewQueries";
import { cn } from "@/lib/utils";
import { deltaDirection, formatDeltaPct, formatInt, formatUsd } from "./format";

/**
 * The four KPI tiles. Every number is server-computed over the selected window;
 * nothing here is derived, estimated or padded — a value the API could not
 * produce is shown as an em dash rather than a zero.
 */

function TrendDelta({
  delta,
  goodWhen = "up",
}: {
  delta: OverviewDelta;
  /** Cost is the one tile where falling is the win. */
  goodWhen?: "up" | "down";
}) {
  const direction = deltaDirection(delta);

  // No previous window means there is nothing to compare against; showing a
  // percentage there would be an invented ∞.
  if (delta.pct === null || direction === "flat") {
    return (
      <span className="text-sm font-medium text-muted-foreground" dir="ltr">
        {delta.pct === null ? "—" : "0%"}
      </span>
    );
  }

  const good = direction === goodWhen;
  return (
    // Semantic tokens, no glow: the surfaces in this console are opaque and a
    // text-shadow halo was the one place the KPI row left the design language.
    <div
      className={cn(
        "flex items-center gap-1.5",
        good ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
      )}
    >
      <HugeiconsIcon
        icon={direction === "up" ? ArrowUpRight01Icon : ArrowDownRight01Icon}
        className="size-3.5 rtl:-scale-x-100"
      />
      <span className="text-sm font-medium" dir="ltr">
        {formatDeltaPct(delta.pct)}
      </span>
    </div>
  );
}

function StatTile({
  title,
  icon,
  value,
  trailing,
  hint,
  footnotes,
}: {
  title: string;
  icon: IconSvgElement;
  value: string;
  trailing: ReactNode;
  hint?: string;
  footnotes?: ReactNode;
}) {
  return (
    <div className="bg-card text-card-foreground rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {hint && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={hint}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <HugeiconsIcon icon={InformationCircleIcon} className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
          )}
        </span>
        <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" />
      </div>

      <div className="bg-muted/50 dark:bg-neutral-800/50 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className="text-2xl font-medium tracking-tight tabular-nums sm:text-3xl"
            dir="ltr"
          >
            {value}
          </span>
          <div className="flex items-center gap-3">
            <div className="h-9 w-px bg-border" />
            {trailing}
          </div>
        </div>
      </div>

      {footnotes}
    </div>
  );
}

function Footnote({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warning";
}) {
  return (
    <p
      className={cn(
        "mt-2 flex items-center gap-1 text-[11px]",
        tone === "warning" ? "text-amber-500" : "text-muted-foreground",
      )}
    >
      {tone === "warning" && <HugeiconsIcon icon={Alert02Icon} className="size-3 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

export function DashboardStatsCards({
  kpis,
  billingVisible,
}: {
  /** null when the signed-in admin lacks `profit_read` — the row disappears. */
  kpis: OverviewKpis | null;
  billingVisible: boolean;
}) {
  if (!kpis) return null;

  const giftAndTrial = kpis.gift_users + kpis.trial_users;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        title="صافي الربح"
        icon={MoneyBag02Icon}
        value={formatUsd(kpis.profit_usd.value)}
        trailing={<TrendDelta delta={kpis.profit_usd} />}
      />

      <StatTile
        title="الإيراد"
        icon={CoinsDollarIcon}
        value={formatUsd(kpis.revenue_usd.value)}
        trailing={<TrendDelta delta={kpis.revenue_usd} />}
      />

      <StatTile
        title="تكلفة المزوّد"
        icon={ServerStack01Icon}
        value={formatUsd(kpis.provider_cost_usd.value)}
        trailing={<TrendDelta delta={kpis.provider_cost_usd} goodWhen="down" />}
        hint="انخفاض تكلفة المزوّد مكسب، لذلك يظهر السهم النازل هنا باللون الأخضر عكس بقية البطاقات."
        footnotes={
          <>
            {kpis.system_cost_usd > 0 && (
              <Footnote>
                منها {formatUsd(kpis.system_cost_usd)} تكلفة نظام غير منسوبة لمستخدم.
              </Footnote>
            )}
            {kpis.unpriced_events > 0 && (
              <Footnote tone="warning">
                {formatInt(kpis.unpriced_events)} حدث بدون تسعير — التكلفة الفعلية أعلى من
                المعروض.
              </Footnote>
            )}
          </>
        }
      />

      <StatTile
        title="المشتركون المدفوعون"
        icon={UserMultiple02Icon}
        value={formatInt(kpis.paying_subscribers.value)}
        trailing={<TrendDelta delta={kpis.paying_subscribers} />}
        footnotes={
          billingVisible && giftAndTrial > 0 ? (
            <Footnote>
              <b className="text-foreground">{formatInt(giftAndTrial)}</b> حساب هدية/تجربة
              خارج هذا العدد.
            </Footnote>
          ) : null
        }
      />
    </div>
  );
}
