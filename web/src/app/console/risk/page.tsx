import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import { RiskSection } from "@/components/bridge/sections/RiskSection";

/**
 * Dedicated Risk Settings page. Uses the canonical trading_settings store and
 * Risk Guard — no parallel risk engine.
 */
export default async function ConsoleRiskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <RiskSection {...await loadConsoleSettingsProps(user)} />;
}
