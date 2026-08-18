import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";
import SettingsClient from "@/components/SettingsClient";

/**
 * One client tree for every settings section so switching `/account` →
 * `/connections` does not remount the form (unsaved alert toggles stay).
 * The URL is the section; the overlay chrome lives in SettingsClient.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <>
      <SettingsClient {...(await loadConsoleSettingsProps(user))} />
      {children}
    </>
  );
}
