import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import { ProfileSection } from "@/components/bridge/sections/ProfileSection";

export default async function SettingsProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <ProfileSection {...await loadConsoleSettingsProps(user)} />;
}
