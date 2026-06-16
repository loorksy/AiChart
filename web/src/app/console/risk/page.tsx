import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import { listUsersForAdmin } from "@/lib/store";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";
import { TradingRiskSection } from "@/components/bridge/sections/TradingRiskSection";

export default async function ConsoleRiskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/console");
  const props = await loadConsoleSettingsProps(user);
  const isAdmin = user.role === "admin";

  return (
    <TradingRiskSection
      {...props}
      adminLimitsSlot={
        isAdmin ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">حدود المستخدمين</h3>
            <AdminUsersTable
              initialUsers={await listUsersForAdmin()}
              adminId={user.id}
              mode="limits"
            />
          </div>
        ) : undefined
      }
    />
  );
}
