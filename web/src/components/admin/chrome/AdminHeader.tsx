"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { SidebarTrigger } from "@/components/squareui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useMe } from "@/hooks/useMe";
import type { AdminPermission } from "@/lib/adminRoles";
import { adminNavItem, adminRoleLabel, type AdminTabId } from "./adminNavTree";

/**
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
  const item = adminNavItem(tab);
  const { data, loading } = useMe();
  const roleLabel = adminRoleLabel(permissions);
  const displayName = data?.displayName ?? "";
  const initial = displayName.trim().charAt(0).toUpperCase();

  return (
    <header
      data-testid="admin-console-header"
      className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-3 sm:px-6"
    >
      <SidebarTrigger className="-ms-1 shrink-0" />
      <HugeiconsIcon
        icon={item.icon}
        strokeWidth={2}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <h2 className="truncate text-sm font-medium">{item.label}</h2>

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
          className="shrink-0"
          aria-label="تحديث البيانات"
          title="تحديث البيانات"
          onClick={() => window.location.reload()}
        >
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
        </Button>

        <ThemeToggle
          collapsed
          className="h-8 min-h-8 w-8 shrink-0 rounded-md border-border bg-background"
        />
      </div>
    </header>
  );
}
