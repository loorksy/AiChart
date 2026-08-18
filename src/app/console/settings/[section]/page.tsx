import { redirect } from "next/navigation";
import {
  isSettingsSectionSlug,
  settingsPath,
} from "@/lib/settings/paths";

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isSettingsSectionSlug(section)) {
    redirect(settingsPath("profile"));
  }
  return null;
}
