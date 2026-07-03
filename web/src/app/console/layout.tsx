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
  description: `${BRAND_NAME} — ${BRAND_TAGLINE_AR} · Claude MCP · Binance · MT5`,
};

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console");
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
