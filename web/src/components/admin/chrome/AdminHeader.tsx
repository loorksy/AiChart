"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLocale } from "@/hooks/useLocale";
import { useMe } from "@/hooks/useMe";
import type { AdminPermission } from "@/lib/adminRoles";
import {
  ADMIN_CONSOLE_TITLE,
  adminLabel,
  adminNavItem,
  adminRoleLabel,
  type AdminTabId,
} from "./adminNavTree";

const REFRESH_LABEL = { label: "تحديث البيانات", labelEn: "Refresh data" };

/**
 * Section header for the platform console. It no longer carries a rail toggle:
 * the console's one navigation lives in AppConsoleShell, which owns both the
 * desktop collapse control and the mobile drawer trigger.
 *
 * The identity strip is the signed-in admin, read from /api/me — never a decorative
 * roster. While the request is in flight the block is a skeleton, because showing a
 * placeholder name would be showing the wrong person.
 */
export function AdminHeader({
  tab,
  permissions,
}: {
  tab: AdminTabId;
  permissions: AdminPermission[];
}) {
  const { locale } = useLocale();
  const item = adminNavItem(tab);
  const { data, loading } = useMe();
  const roleLabel = adminRoleLabel(permissions, locale);
  const displayName = data?.displayName ?? "";
  const initial = displayName.trim().charAt(0).toUpperCase();

  return (
    <header
      data-testid="admin-console-header"
      className="sticky top-0 z-raised flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-3 sm:px-6"
    >
      <HugeiconsIcon
        icon={item.icon}
        strokeWidth={2}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
          {adminLabel(ADMIN_CONSOLE_TITLE, locale)}
        </span>
        <h2 className="truncate text-sm font-medium">{adminLabel(item, locale)}</h2>
      </div>

      <div className="ms-auto flex min-w-0 items-center gap-2">
        {loading && !data ? (
          <span
            aria-hidden
            className="h-7 w-24 animate-pulse rounded-md bg-muted sm:w-36"
          />
        ) : data ? (
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
            >
              {initial}
            </span>
            <span className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-xs font-medium">{displayName}</span>
              <span
                dir="ltr"
                className="truncate text-start text-[10px] text-muted-foreground"
              >
                {data.user.email}
              </span>
            </span>
          </span>
        ) : null}

        <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
          {roleLabel}
        </Badge>

        {/* Panels each load their own data on mount, so a full reload is the only
            refresh that is honest about covering all of them. */}
        <Button
          variant="outline"
          size="icon-sm"
          className="size-11 shrink-0 transition-colors duration-150 ease-out sm:size-8"
          aria-label={adminLabel(REFRESH_LABEL, locale)}
          title={adminLabel(REFRESH_LABEL, locale)}
          onClick={() => window.location.reload()}
        >
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
        </Button>

        <ThemeToggle
          collapsed
          className="size-11 min-h-11 shrink-0 rounded-md border-border bg-background sm:size-8 sm:min-h-8"
        />
      </div>
    </header>
  );
}
