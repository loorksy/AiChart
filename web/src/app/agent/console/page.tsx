import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { PageLayout } from "@/components/ui/shell";
import { OpenClawConsoleClient } from "@/components/agent/OpenClawConsoleClient";

export const dynamic = "force-dynamic";

export default async function AgentConsolePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/agent/console");
  if (user.role !== "admin") redirect("/agent");

  return (
    <AppShell email={user.email} role={user.role}>
      <PageLayout
        title="إعدادات OpenClaw"
        subtitle="Control Web UI — كل خيارات وإعدادات الوكيل"
        maxWidth="2xl"
      >
        <OpenClawConsoleClient />
      </PageLayout>
    </AppShell>
  );
}
