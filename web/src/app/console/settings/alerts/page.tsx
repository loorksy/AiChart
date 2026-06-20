import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import { AlertsSection } from "@/components/bridge/sections/AlertsSection";

export default async function SettingsAlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <AlertsSection {...await loadConsoleSettingsProps(user)} />;
}
