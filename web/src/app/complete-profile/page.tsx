import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getAccessBlockReason,
  hasPlatformAccess,
} from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { CompleteProfileClient } from "@/components/CompleteProfileClient";

export default async function CompleteProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!needsMcpCredentials(user)) {
    if (hasPlatformAccess(user)) redirect("/workspace");
    const reason = getAccessBlockReason(user);
    if (reason) redirect("/awaiting-approval");
    redirect("/workspace");
  }

  return <CompleteProfileClient user={user} />;
}
