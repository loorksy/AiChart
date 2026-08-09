"use client";

import type { ComponentType, ReactNode } from "react";
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
import { StatGrid, StatTile } from "@/components/admin/ui/AdminKit";
import type { OverviewDelta, OverviewKpis } from "@/lib/admin/overviewQueries";
import { cn } from "@/lib/utils";
import { deltaDirection, formatDeltaPct, formatInt, formatUsd } from "./format";

/**
 * The four KPI tiles. Every number is server-computed over the selected window;
 * nothing here is derived, estimated or padded — a value the API could not
 * produce is shown as an em dash rather than a zero.
 *
 * Layout is the AdminKit flat `StatTile` — the same tile the users and usage
 * tabs render — with the trend delta in the tile's `trailing` slot and the
 * honest footnotes in `footer`. No card-in-card.
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
    // buy/sell are the product's profit/loss pair and carry light+dark values;
    // destructive stays reserved for system failures.
    <div
      className={cn("flex items-center gap-1.5", good ? "text-buy" : "text-sell")}
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

/** Adapts a hugeicons glyph to the `ComponentType` slot AdminKit exposes. */
function hugeIcon(icon: IconSvgElement): ComponentType<{ className?: string }> {
  return function TileIcon({ className }: { className?: string }) {
    return <HugeiconsIcon icon={icon} className={className} />;
  };
}

const ICON_PROFIT = hugeIcon(MoneyBag02Icon);
const ICON_REVENUE = hugeIcon(CoinsDollarIcon);
const ICON_COST = hugeIcon(ServerStack01Icon);
const ICON_SUBSCRIBERS = hugeIcon(UserMultiple02Icon);

function LabelWithHint({ label, hint }: { label: string; hint: string }) {
  return (
    <>
      <span className="truncate">{label}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={hint}
              className="focus-ring tap-target-expand rounded text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
            >
              <HugeiconsIcon icon={InformationCircleIcon} className="size-3.5" />
            </button>
          }
        />
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </>
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
        tone === "warning" ? "text-warning" : "text-muted-foreground",
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
    <StatGrid>
      <StatTile
        index={0}
        label="صافي الربح"
        icon={ICON_PROFIT}
        value={formatUsd(kpis.profit_usd.value)}
        trailing={<TrendDelta delta={kpis.profit_usd} />}
      />

      <StatTile
        index={1}
        label="الإيراد"
        icon={ICON_REVENUE}
        value={formatUsd(kpis.revenue_usd.value)}
        trailing={<TrendDelta delta={kpis.revenue_usd} />}
      />

      <StatTile
        index={2}
        label={
          <LabelWithHint
            label="تكلفة المزوّد"
            hint="انخفاض تكلفة المزوّد مكسب، لذلك يظهر السهم النازل هنا باللون الأخضر عكس بقية البطاقات."
          />
        }
        icon={ICON_COST}
        value={formatUsd(kpis.provider_cost_usd.value)}
        trailing={<TrendDelta delta={kpis.provider_cost_usd} goodWhen="down" />}
        footer={
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
        index={3}
        label="المشتركون المدفوعون"
        icon={ICON_SUBSCRIBERS}
        value={formatInt(kpis.paying_subscribers.value)}
        trailing={<TrendDelta delta={kpis.paying_subscribers} />}
        footer={
          billingVisible && giftAndTrial > 0 ? (
            <Footnote>
              <b className="text-foreground">{formatInt(giftAndTrial)}</b> حساب هدية/تجربة
              خارج هذا العدد.
            </Footnote>
          ) : null
        }
      />
    </StatGrid>
  );
}
