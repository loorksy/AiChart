import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getForexBackend } from "@/lib/brokers/forexBackend";
import { getSettings, getLimits, getBinanceAccountMeta, getMtAccountMeta } from "@/lib/store";
import { getEaConnectionMeta } from "@/lib/eaStore";
import AppShell from "@/components/AppShell";
import SettingsClient from "@/components/SettingsClient";

const TAB_IDS = [
  "profile",
  "subscription",
  "appearance",
  "integrations",
  "alerts",
  "trading",
] as const;

type TabId = (typeof TAB_IDS)[number];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { tab } = await searchParams;
  const initialTab = TAB_IDS.includes(tab as TabId) ? (tab as TabId) : undefined;
  const forexBackend = getForexBackend();

  return (
    <AppShell email={user.email} role={user.role}>
      <SettingsClient
        user={user}
        settings={await getSettings(user.id)}
        limits={await getLimits(user.id)}
        binance={await getBinanceAccountMeta(user.id)}
        ea={await getEaConnectionMeta(user.id)}
        mt={forexBackend === "metaapi" ? await getMtAccountMeta(user.id) : null}
        forexBackend={forexBackend}
        initialTab={initialTab}
      />
    </AppShell>
  );
}
