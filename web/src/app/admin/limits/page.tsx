import { redirect } from "next/navigation";

export default function AdminLimitsRedirect() {
  redirect("/console/risk");
}
