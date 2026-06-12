import { redirect } from "next/navigation";

export default function AdminSecurityRedirect() {
  redirect("/console/platform?tab=security");
}
