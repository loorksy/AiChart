"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { AiChartLogo } from "@/components/AiChartLogo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/squareui/sidebar";
import { cn } from "@/lib/utils";
import type { AdminPermission } from "@/lib/adminRoles";
import {
  ADMIN_NAV_GROUPS,
  ADMIN_PROFILE_ITEM,
  adminRoleLabel,
  canOpenAdminTab,
  type AdminNavGroup,
  type AdminNavItem,
  type AdminTabId,
} from "./adminNavTree";

/**
 * Tabs are real navigations (`<a href>`), exactly as the pill strip they replace —
 * every panel loads its own server data on mount, so a client-side transition
 * would buy nothing and would break the browser back button's panel restore.
 */
function AdminNavLink({ item, active }: { item: AdminNavItem; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        render={<a href={`/console/platform?tab=${item.id}`} />}
      >
        <HugeiconsIcon icon={item.icon} strokeWidth={2} />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AdminNavGroupSection({
  group,
  tab,
  permissions,
}: {
  group: AdminNavGroup;
  tab: AdminTabId;
  permissions: AdminPermission[];
}) {
  const { state, isMobile } = useSidebar();
  const [open, setOpen] = useState(true);
  const items = group.items.filter((item) => canOpenAdminTab(item, permissions));

  if (!items.length) return null;

  // In icon mode the group label — and with it the disclosure control — is
  // animated out of view, so a folded group would hide its icons with no way to
  // unfold them. Force every group open for as long as the rail is icon-only.
  const iconMode = state === "collapsed" && !isMobile;
  const expanded = iconMode || open;

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        render={<button type="button" />}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expanded}
        className="w-full cursor-pointer text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground group-data-[collapsible=icon]:pointer-events-none"
      >
        <span className="truncate">{group.label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className={cn(
            "ms-auto shrink-0 transition-transform duration-150",
            !expanded && "ltr:-rotate-90 rtl:rotate-90",
          )}
        />
      </SidebarGroupLabel>
      {expanded ? (
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => (
              <AdminNavLink key={item.id} item={item} active={item.id === tab} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}

export function AdminSidebar({
  tab,
  permissions,
}: {
  tab: AdminTabId;
  permissions: AdminPermission[];
}) {
  const roleLabel = adminRoleLabel(permissions);

  return (
    // side="right" keeps the rail on the reading-start edge under dir="rtl"; the
    // kit's border classes carry no colour of their own in this project (there is
    // no global border-color reset), hence the explicit border-sidebar-border.
    <Sidebar side="right" collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="لوحة المنصة"
              render={<a href="/console/platform?tab=overview" />}
            >
              <AiChartLogo size={24} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-semibold">لوحة المنصة</span>
                <span className="truncate text-[11px] font-normal text-sidebar-foreground/60">
                  {roleLabel}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {ADMIN_NAV_GROUPS.map((group) => (
          <AdminNavGroupSection
            key={group.id}
            group={group}
            tab={tab}
            permissions={permissions}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <AdminNavLink item={ADMIN_PROFILE_ITEM} active={tab === "profile"} />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
