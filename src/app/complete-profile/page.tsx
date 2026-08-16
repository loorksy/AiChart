import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { CompleteProfileForm } from "@/components/CompleteProfileForm";

/**
 * Where the chat/console layouts send a user whose MCP credentials are
 * incomplete (`needsMcpCredentials`) — previously a 404: the redirects
 * survived the migration, the page did not. The form must live ON this page
 * (see CompleteProfileForm) because every other surface bounces this user
 * straight back here.
 */
export default async function CompleteProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Profile already complete: nothing to do here.
  if (!needsMcpCredentials(user)) redirect("/chat");

  return <CompleteProfileForm />;
}
