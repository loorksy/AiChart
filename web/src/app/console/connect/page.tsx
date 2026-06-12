import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import { ConnectSection } from "@/components/bridge/sections/ConnectSection";

export default async function ConsoleConnectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <ConnectSection {...await loadConsoleSettingsProps(user)} />;
}
