import { redirect } from "next/navigation";

const TAB_MAP: Record<string, string> = {
  profile: "/console/platform?tab=profile",
  subscription: "/console/platform?tab=profile",
  appearance: "/console/platform?tab=profile",
  integrations: "/console/connect",
  alerts: "/console/connect",
  trading: "/console/risk",
};

export default async function SettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  redirect(tab && TAB_MAP[tab] ? TAB_MAP[tab] : "/console/connect");
}
