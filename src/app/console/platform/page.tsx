import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAuditLogs, listClaudeUsageForAdmin, listUsersForAdmin } from "@/lib/store";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import {
  getAdminRole,
  permissionsForRole,
  type AdminPermission,
} from "@/lib/adminRoles";
import { PlatformSection } from "@/components/bridge/sections/PlatformSection";

function PlatformFallback() {
  return <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>;
}

export default async function ConsolePlatformPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Straight to /chat: "/console" is not a page, only a legacy next.config
  // redirect that hops /console → /workspace → /chat. In-code navigation
  // should not ride a compatibility chain kept for external deep links.
  if (user.role !== "admin") redirect("/chat");
  const props = await loadConsoleSettingsProps(user);
  const isAdmin = true;
  // Sourced from admin_roles server-side; the client only ever hides nav with it.
  // Each admin API re-checks the same permission with requireAdminWith.
  const permissions = permissionsForRole(await getAdminRole(user.id));
  const may = (permission: AdminPermission) => permissions.includes(permission);

  // Server-side redaction, not a render guard: anything passed here is
  // serialized into the RSC payload and readable in devtools by ANY admin who
  // loads this page. Hiding a tab client-side would leave the roster and the
  // audit trail one view-source away from a support-role admin.
  const [audit, usage, adminUsers] = await Promise.all([
    may("keys_write") ? listAuditLogs(100) : Promise.resolve([]),
    may("keys_write") ? listClaudeUsageForAdmin() : Promise.resolve([]),
    may("users_read") ? listUsersForAdmin() : Promise.resolve([]),
  ]);

  return (
    <Suspense fallback={<PlatformFallback />}>
      <PlatformSection
        isAdmin={isAdmin}
        permissions={permissions}
        profileProps={props}
        audit={audit}
        usage={usage}
        adminUsers={adminUsers}
        adminId={user.id}
      />
    </Suspense>
  );
}
