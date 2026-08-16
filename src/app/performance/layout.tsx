import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { displayNameForUser } from "@/lib/displayName";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import { requirePaidPage } from "@/lib/subscription/guards";
import { BRAND_NAME } from "@/lib/brand";
import { privateSurfaceMetadata } from "@/lib/seo";

export const metadata: Metadata = privateSurfaceMetadata(
  `الأداء — ${BRAND_NAME}`,
);

/** Unified performance page (recommendations + trades + statistics). */
export default async function PerformanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/performance");
  if (user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }
  if (user.role !== "admin") {
    await requirePaidPage(user, "/performance");
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
