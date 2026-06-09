import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getSettings,
  getLimits,
  getBinanceAccountMeta,
  isOnboardingDone,
  listIntents,
  listTrades,
} from "@/lib/store";
import AppShell from "@/components/AppShell";
import DashboardClient from "@/components/DashboardClient";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && !(await isOnboardingDone(user.id))) {
    redirect("/onboarding");
  }

  const settings = await getSettings(user.id);
  const limits = await getLimits(user.id);
  const binance = await getBinanceAccountMeta(user.id);
  const pendingIntents = await listIntents(user.id, "pending", 50);
  const trades = await listTrades(user.id, 200);

  return (
    <AppShell email={user.email} role={user.role}>
      <DashboardClient
        user={user}
        settings={settings}
        limits={limits}
        hasBinance={Boolean(binance)}
        pendingIntentCount={pendingIntents.length}
        trades={trades}
      />
    </AppShell>
  );
}
