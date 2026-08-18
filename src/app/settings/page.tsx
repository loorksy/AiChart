import { redirect } from "next/navigation";
import { settingsPath } from "@/lib/settings/paths";

export default function SettingsRedirect() {
  redirect(settingsPath("profile"));
}
