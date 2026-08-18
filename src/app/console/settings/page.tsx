import { redirect } from "next/navigation";
import {
  settingsPath,
  settingsTabFromLegacyQuery,
} from "@/lib/settings/paths";

export default async function SettingsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const id = settingsTabFromLegacyQuery(tab) ?? "profile";
  redirect(settingsPath(id));
}
