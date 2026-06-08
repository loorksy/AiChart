import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSettings, getLimits, getBinanceAccountMeta } from "@/lib/store";
import AppShell from "@/components/AppShell";
import SettingsClient from "@/components/SettingsClient";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell email={user.email} role={user.role}>
      <SettingsClient
        user={user}
        settings={getSettings(user.id)}
        limits={getLimits(user.id)}
        binance={getBinanceAccountMeta(user.id)}
      />
    </AppShell>
  );
}
