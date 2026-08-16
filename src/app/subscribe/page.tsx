import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { displayNameForUser } from "@/lib/displayName";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import { SubscribeClient } from "@/components/subscription/SubscribeClient";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";
import { initDb } from "@/lib/db";
import { FEATURES } from "@/lib/agent/featureFlags";

export default async function SubscribePage() {
  if (!FEATURES.billing()) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/subscribe");
  await initDb();
  const entitlement = await getEntitlementForUser(user);
  if (entitlement.isAdmin || entitlement.hasPaidAccess) {
    redirect("/chat");
  }

  return (
    <AppConsoleShell
      role="user"
      displayName={displayNameForUser(user)}
      showConversations={false}
    >
      <SubscribeClient
        mode={entitlement.access === "trial" ? "trial" : "blocked"}
        trialRemaining={entitlement.trialRemaining}
      />
    </AppConsoleShell>
  );
}
