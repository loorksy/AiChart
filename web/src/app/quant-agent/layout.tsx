import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { displayNameForUser } from "@/lib/displayName";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import { requirePaidPage } from "@/lib/subscription/guards";

/** Quant Agent lives inside the unified app shell (one nav), same as Journal/Performance. */
export default async function QuantAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/quant-agent");
  if (user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }
  if (user.role !== "admin") {
    await requirePaidPage(user, "/quant-agent");
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
