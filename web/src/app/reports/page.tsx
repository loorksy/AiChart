import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isOnboardingDone, listTrades } from "@/lib/store";
import AppShell from "@/components/AppShell";
import ReportsClient from "@/components/ReportsClient";

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && !(await isOnboardingDone(user.id))) {
    redirect("/onboarding");
  }

  const trades = await listTrades(user.id, 500);

  return (
    <AppShell email={user.email} role={user.role}>
      <ReportsClient trades={trades} userEmail={user.email} />
    </AppShell>
  );
}
