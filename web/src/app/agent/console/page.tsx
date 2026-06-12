import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AgentConsoleRedirect() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console/platform?tab=system");
  redirect("/console/platform?tab=system");
}
