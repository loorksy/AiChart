import { redirect } from "next/navigation";

/** Legacy URL kept as a forward-only redirect; the Risk page no longer exists. */
export default function ConsoleRiskPage() {
  redirect("/console/settings");
}
