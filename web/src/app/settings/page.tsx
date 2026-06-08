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
        settings={await getSettings(user.id)}
        limits={await getLimits(user.id)}
        binance={await getBinanceAccountMeta(user.id)}
      />
    </AppShell>
  );
}
