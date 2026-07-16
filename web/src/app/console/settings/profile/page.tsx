import { redirect } from "next/navigation";

export default function LegacyProfileSettingsPage() {
  redirect("/console/settings?tab=profile");
}
