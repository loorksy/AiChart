"use client";

import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import type { ClaudeUsageRow } from "@/lib/store";
import type { AdminPermission } from "@/lib/adminRoles";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { AdminHeader } from "@/components/admin/chrome/AdminHeader";
import {
  adminLabel,
  adminNavItem,
  canOpenAdminTab,
  resolveAdminTab,
} from "@/components/admin/chrome/adminNavTree";
import { useLocale } from "@/hooks/useLocale";
import { PlatformDashboard } from "@/components/admin/dashboard/PlatformDashboard";
import { AdminDiagnosticsPanel } from "@/components/admin/AdminDiagnosticsPanel";
import { AdminKeysPanel } from "@/components/admin/AdminKeysPanel";
import { AdminSystemPanel } from "@/components/admin/AdminSystemPanel";
import { AdminSecurityPanel } from "@/components/admin/AdminSecurityPanel";
import { AdminUsagePanel } from "@/components/admin/AdminUsagePanel";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";
import { AdminSubscriptionsPanel } from "@/components/admin/AdminSubscriptionsPanel";
import { AdminBillingPanel } from "@/components/admin/AdminBillingPanel";
import { AdminBillingConfigPanel } from "@/components/admin/AdminBillingConfigPanel";
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

const DENIED = {
  label: "ليست لديك صلاحية لهذا القسم.",
  labelEn: "You do not have permission for this section.",
};

const NON_ADMIN_HEADING = {
  label: "المنصة والمفاتيح",
  labelEn: "Platform and keys",
};

const NON_ADMIN_SUBHEADING = {
  label: "MCP، مفاتيح API، الأمن",
  labelEn: "MCP, API keys, security",
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
  const { dir, locale } = useLocale();
  const tab = resolveAdminTab(params.get("tab"), isAdmin);

  // A non-admin only ever had the profile tab here.
  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">{adminLabel(NON_ADMIN_HEADING, locale)}</h2>
          <p className="text-sm text-muted-foreground">
            {adminLabel(NON_ADMIN_SUBHEADING, locale)}
          </p>
        </div>
        <ProfileSection {...profileProps} />
      </div>
    );
  }

  const allowed = canOpenAdminTab(adminNavItem(tab), permissions);

  return (
    // Base UI reads direction from context and defaults to "ltr", so without
    // this every logical side/align (menu alignment, submenu arrow keys) inside
    // the admin panels resolves to the wrong physical edge. It follows the live
    // locale rather than a hard-coded "rtl" so switching to English flips it.
    <DirectionProvider direction={dir}>
      {/* No rail of its own: the console's single navigation is AppConsoleShell's
          sidebar, which now carries the full grouped admin tree. A second
          <Sidebar> here was the duplicate-navigation defect. */}
      <div
        data-testid="admin-console-chrome"
        className="flex min-h-0 w-full min-w-0 flex-1 flex-col"
      >
        <AdminHeader tab={tab} permissions={permissions} />
        <div className="min-w-0 flex-1 py-4 sm:px-4">
          {!allowed ? (
            <p className="text-sm text-muted-foreground">{adminLabel(DENIED, locale)}</p>
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
              {tab === "billing-config" && <AdminBillingConfigPanel />}
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
    </DirectionProvider>
  );
}
