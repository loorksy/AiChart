import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAuditLogs, listClaudeUsageForAdmin, listUsersForAdmin } from "@/lib/store";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import { PlatformSection } from "@/components/bridge/sections/PlatformSection";

function PlatformFallback() {
  return <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>;
}

export default async function ConsolePlatformPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (user.role !== "admin") redirect("/console");
  const props = await loadConsoleSettingsProps(user);
  const isAdmin = true;

  return (
    <Suspense fallback={<PlatformFallback />}>
      <PlatformSection
        isAdmin={isAdmin}
        profileProps={props}
        audit={await listAuditLogs(100)}
        usage={await listClaudeUsageForAdmin()}
        adminUsers={await listUsersForAdmin()}
        adminId={user.id}
      />
    </Suspense>
  );
}
