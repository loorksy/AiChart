import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import SettingsClient from "@/components/SettingsClient";

type Tab = "profile" | "appearance" | "integrations" | "alerts" | "trading" | "skills";
const TABS = new Set<Tab>(["profile", "appearance", "integrations", "alerts", "trading", "skills"]);

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const requested = (await searchParams).tab;
  const initialTab = requested && TABS.has(requested as Tab) ? (requested as Tab) : undefined;
  return <SettingsClient {...(await loadConsoleSettingsProps(user))} initialTab={initialTab} />;
}
