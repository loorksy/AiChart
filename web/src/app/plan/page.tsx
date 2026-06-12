import { redirect } from "next/navigation";

export default function PlanRedirect() {
  redirect("/console/platform?tab=profile");
}
