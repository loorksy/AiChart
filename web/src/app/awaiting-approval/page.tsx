import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getAccessBlockReason,
  hasPlatformAccess,
} from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { AwaitingApprovalClient } from "@/components/AwaitingApprovalClient";

export default async function AwaitingApprovalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (needsMcpCredentials(user)) redirect("/complete-profile");
  if (hasPlatformAccess(user)) redirect("/console");

  const reason = getAccessBlockReason(user);
  if (!reason) redirect("/console");

  return (
    <AwaitingApprovalClient
      reason={reason}
      email={user.email}
      viaTelegram={Boolean(user.telegram_id)}
    />
  );
}
