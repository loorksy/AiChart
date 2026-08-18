import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import SettingsClient from "@/components/SettingsClient";
import {
  settingsPath,
  settingsTabFromSlug,
  isSettingsSectionSlug,
} from "@/lib/settings/paths";

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { section } = await params;
  if (!isSettingsSectionSlug(section)) {
    redirect(settingsPath("profile"));
  }
  const initialTab = settingsTabFromSlug(section) ?? "profile";
  return (
    <SettingsClient
      key={initialTab}
      {...(await loadConsoleSettingsProps(user))}
      initialTab={initialTab}
    />
  );
}
