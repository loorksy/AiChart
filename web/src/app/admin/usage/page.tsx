import { redirect } from "next/navigation";

export default function AdminUsageRedirect() {
  redirect("/console/platform?tab=usage");
}
