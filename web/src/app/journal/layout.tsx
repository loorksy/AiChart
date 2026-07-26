import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { displayNameForUser } from "@/lib/displayName";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import { requirePaidPage } from "@/lib/subscription/guards";

/** The performance journal lives inside the unified app shell (one nav). */
export default async function JournalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/journal");
  if (user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }
  if (user.role !== "admin") {
    await requirePaidPage(user, "/journal");
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
