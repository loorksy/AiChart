import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  accessBlockMessage,
  getAccessBlockReason,
  hasPlatformAccess,
} from "@/lib/platformAccess";
import { AccessBlockedCard } from "@/components/AccessBlockedCard";

/**
 * The page five layouts were already redirecting to.
 *
 * Every entry surface (`/`, chat, console, performance, recommendations) sends
 * a user without platform access here — and until now "here" was a 404,
 * because the migration deleted the old client while the redirects to it
 * stayed. A blocked user could not learn WHY they were blocked; they just
 * watched every page bounce them into a missing one.
 *
 * On the public platform only a manual `suspended` still blocks
 * (`getAccessBlockReason`), but the page renders whatever reason the helper
 * reports rather than hard-coding one — the copy for pending/expired already
 * exists in `accessBlockMessage` and this page must not fork it.
 */
export default async function AwaitingApprovalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Access restored (or an admin wandered in): this page has nothing to say.
  if (hasPlatformAccess(user)) redirect("/chat");

  const reason = getAccessBlockReason(user) ?? "suspended";
  return <AccessBlockedCard message={accessBlockMessage(reason)} />;
}
