import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { displayNameForUser } from "@/lib/displayName";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";

import { BRAND_NAME, BRAND_TAGLINE_AR } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND_NAME} — لوحة التحكم`,
  description: `${BRAND_NAME} — ${BRAND_TAGLINE_AR} · MetaTrader 5`,
};

/**
 * The chat surface's shell — sidebar navigation, conversations list and the
 * mobile drawer. This lived on /workspace before the surface moved to /chat;
 * the page moved but the layout was left behind, so /chat rendered bare (no
 * sidebar, no hamburger on mobile). Moved here to finish that migration.
 */
export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/chat");
  if (needsMcpCredentials(user)) redirect("/complete-profile");
  if (user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }

  return (
    <AppConsoleShell
      role={user.role === "admin" ? "admin" : "user"}
      displayName={displayNameForUser(user)}
    >
      {children}
    </AppConsoleShell>
  );
}
