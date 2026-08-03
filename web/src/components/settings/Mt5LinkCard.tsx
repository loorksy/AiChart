"use client";

import Link from "next/link";
import { Link2 } from "lucide-react";

import { AccountTypeBadge, toAccountType } from "@/components/agent/AccountTypeBadge";
import { SurfaceCard } from "@/components/ui/shell";
import { buttonVariants } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import type { MtAccountMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The way in to the MetaTrader linking wizard.
 *
 * /console/mt5 has existed since V2-B and works, but nothing in the product
 * linked to it — an operator could configure METAAPI_TOKEN, switch the feature
 * on, and still find no place for a trader to hand over their account. The
 * connections tab already promised "MetaTrader · MCP · Telegram" in its own
 * subtitle while rendering only the last two.
 *
 * Rendered only when the wizard itself would render its live form, so the
 * button can never lead to the "not enabled yet" wall.
 */
export function Mt5LinkCard({ account }: { account: MtAccountMeta | null }) {
  const { t } = useLocale();
  const linked = account != null;

  // No data-testid below: SurfaceCard takes children/className/padding only and
  // drops anything else, so the two neighbouring cards already carry one that
  // never reaches the DOM. Not worth adding a third.
  return (
    <SurfaceCard className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t("connect.mt5.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("connect.mt5.subtitle")}
          </p>
        </div>
        {linked && (
          <AccountTypeBadge type={toAccountType(account.account_trade_mode)} />
        )}
      </div>

      {linked ? (
        // Server and login are identifiers, not prose — keep them LTR so the
        // digits of a login do not reorder inside an RTL paragraph.
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("connect.mt5.linked")}
            </dt>
            <dd className="truncate font-medium" dir="ltr">
              {account.server}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">MetaTrader</dt>
            <dd className="truncate font-medium tabular-nums" dir="ltr">
              {account.login}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("connect.mt5.body")}
        </p>
      )}

      <Link
        href="/console/mt5"
        className={cn(buttonVariants({ variant: linked ? "outline" : "default" }))}
      >
        <Link2 className="size-4" aria-hidden />
        {linked ? t("connect.mt5.manage") : t("connect.mt5.cta")}
      </Link>
    </SurfaceCard>
  );
}
