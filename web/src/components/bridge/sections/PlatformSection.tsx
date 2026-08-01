"use client";

import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import type { ClaudeUsageRow } from "@/lib/store";
import type { AdminPermission } from "@/lib/adminRoles";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { SidebarProvider } from "@/components/squareui/sidebar";
import { AdminHeader } from "@/components/admin/chrome/AdminHeader";
import { AdminSidebar } from "@/components/admin/chrome/AdminSidebar";
import {
  adminNavItem,
  canOpenAdminTab,
  resolveAdminTab,
} from "@/components/admin/chrome/adminNavTree";
import { PlatformDashboard } from "@/components/admin/dashboard/PlatformDashboard";
import { AdminDiagnosticsPanel } from "@/components/admin/AdminDiagnosticsPanel";
import { AdminKeysPanel } from "@/components/admin/AdminKeysPanel";
import { AdminSystemPanel } from "@/components/admin/AdminSystemPanel";
import { AdminSecurityPanel } from "@/components/admin/AdminSecurityPanel";
import { AdminUsagePanel } from "@/components/admin/AdminUsagePanel";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";
import { AdminSubscriptionsPanel } from "@/components/admin/AdminSubscriptionsPanel";
import { AdminBillingPanel } from "@/components/admin/AdminBillingPanel";
import { AdminTeamPanel } from "@/components/admin/AdminTeamPanel";
import { AdminSupportPanel } from "@/components/admin/AdminSupportPanel";
import { ProfileSection } from "@/components/bridge/sections/ProfileSection";

type AuditRow = {
  id: number;
  user_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
};

type ProfileProps = ComponentProps<typeof ProfileSection>;

export function PlatformSection({
  isAdmin,
  permissions,
  profileProps,
  audit = [],
  usage = [],
  adminUsers = [],
  adminId = 0,
}: {
  isAdmin: boolean;
  permissions: AdminPermission[];
  profileProps: ProfileProps;
  audit?: AuditRow[];
  usage?: ClaudeUsageRow[];
  adminUsers?: import("@/lib/store").AdminUserView[];
  adminId?: number;
}) {
  const params = useSearchParams();
  const tab = resolveAdminTab(params.get("tab"), isAdmin);

  // A non-admin only ever had the profile tab here; the admin chrome would be a
  // sidebar of destinations none of which they may open.
  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">المنصة والمفاتيح</h2>
          <p className="text-sm text-muted-foreground">MCP، مفاتيح API، الأمن</p>
        </div>
        <ProfileSection {...profileProps} />
      </div>
    );
  }

  const allowed = canOpenAdminTab(adminNavItem(tab), permissions);

  return (
    // Base UI reads direction from context and defaults to "ltr", so without
    // this every logical side/align (collapsed-rail tooltips, menu alignment,
    // submenu arrow keys) resolves to the wrong physical edge in this RTL app.
    <DirectionProvider direction="rtl">
    {/* min-h-0 replaces the kit's min-h-svh: this console is nested inside
        AppConsoleShell's scrolling <main>, so a viewport-height floor here would
        add a second scrollbar. No overflow clipping either — it would trap the
        rail's `position: sticky` inside this box. */}
    <SidebarProvider
      data-testid="admin-console-chrome"
      className="min-h-0 w-full items-stretch"
    >
      <AdminSidebar tab={tab} permissions={permissions} />
      {/* Deliberately a <div>, not the kit's SidebarInset: that renders a <main>
          and AppConsoleShell already owns the page's only <main>. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <AdminHeader tab={tab} permissions={permissions} />
        <div className="min-w-0 flex-1 py-4 sm:px-4">
          {!allowed ? (
            <p className="text-sm text-muted-foreground">
              ليست لديك صلاحية لهذا القسم.
            </p>
          ) : (
            <>
              {tab === "overview" && (
                <PlatformDashboard adminId={adminId} permissions={permissions} />
              )}
              {tab === "users" && (
                <AdminUsersTable
                  initialUsers={adminUsers}
                  adminId={adminId}
                  mode="full"
                />
              )}
              {tab === "team" && <AdminTeamPanel />}
              {tab === "support" && <AdminSupportPanel />}
              {tab === "billing" && <AdminBillingPanel />}
              {tab === "subscriptions" && <AdminSubscriptionsPanel />}
              {tab === "keys" && <AdminKeysPanel />}
              {tab === "system" && <AdminSystemPanel />}
              {tab === "diagnostics" && <AdminDiagnosticsPanel />}
              {tab === "security" && <AdminSecurityPanel audit={audit} />}
              {tab === "usage" && <AdminUsagePanel initialUsage={usage} />}
              {tab === "profile" && <ProfileSection {...profileProps} />}
            </>
          )}
        </div>
      </div>
    </SidebarProvider>
    </DirectionProvider>
  );
}
