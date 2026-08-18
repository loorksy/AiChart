import { redirect } from "next/navigation";
import {
  settingsPath,
  settingsTabFromLegacyQuery,
} from "@/lib/settings/paths";

/** `/settings/connections` and old tab-id aliases land on the console paths. */
export default async function SettingsAliasPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  redirect(settingsPath(settingsTabFromLegacyQuery(section) ?? "profile"));
}
