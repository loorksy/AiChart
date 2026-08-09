import { redirect } from "next/navigation";

const TAB_MAP: Record<string, string> = {
  profile: "/console/settings/profile",
  subscription: "/console/settings/profile",
  appearance: "/console/settings/profile",
  integrations: "/console/connect",
  alerts: "/console/settings/alerts",
};

export default async function SettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  redirect(tab && TAB_MAP[tab] ? TAB_MAP[tab] : "/console/settings");
}
