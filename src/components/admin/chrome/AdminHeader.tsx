"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/squareui/badge";
import { useLocale } from "@/hooks/useLocale";
import type { AdminPermission } from "@/lib/adminRoles";
import {
  ADMIN_CONSOLE_TITLE,
  adminLabel,
  adminNavItem,
  adminRoleLabel,
  type AdminTabId,
} from "./adminNavTree";

/**
 * Which panel you are on, and nothing else.
 *
 * This used to be a second console header: it carried its own avatar, refresh
 * control and theme toggle, stacked directly under the shell's own bar, so the
 * admin console had two headers competing for the same job while the trader
 * console had one. All three moved to the shared top bar, which both consoles
 * now use; what is left here is the part only this route can say — the section
 * name, and the role it is being viewed with.
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
  const roleLabel = adminRoleLabel(permissions, locale);

  return (
    <header
      data-testid="admin-console-header"
      className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 sm:px-6"
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

      <Badge variant="secondary" className="ms-auto hidden shrink-0 sm:inline-flex">
        {roleLabel}
      </Badge>
    </header>
  );
}
