import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAuditLogs, listClaudeUsageForAdmin } from "@/lib/store";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import { PlatformSection } from "@/components/bridge/sections/PlatformSection";

function PlatformFallback() {
  return <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>;
}

export default async function ConsolePlatformPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const profileProps = await loadConsoleSettingsProps(user);
  const isAdmin = user.role === "admin";

  return (
    <Suspense fallback={<PlatformFallback />}>
      <PlatformSection
        isAdmin={isAdmin}
        profileProps={profileProps}
        audit={isAdmin ? await listAuditLogs(100) : []}
        usage={isAdmin ? await listClaudeUsageForAdmin() : []}
      />
    </Suspense>
  );
}
