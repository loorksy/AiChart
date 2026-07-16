import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function ConsoleMcpPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/console/connect");
  redirect("/console/platform?tab=system");
}
