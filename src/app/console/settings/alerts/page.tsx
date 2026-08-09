import { redirect } from "next/navigation";

export default function LegacyAlertSettingsPage() {
  redirect("/console/settings?tab=alerts");
}
