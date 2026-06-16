import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UserAccountClient } from "@/components/user/UserAccountClient";

export default async function ConsoleAccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/console/platform?tab=profile");

  return <UserAccountClient user={user} />;
}
