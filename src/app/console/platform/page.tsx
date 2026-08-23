import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

/**
 * The admin console moved out of the web app.
 *
 * Everything that used to live behind `?tab=` — users, subscriptions,
 * pricing, keys, ads, support, diagnostics — is now the Flutter app served at
 * /admin-app/, and this route exists only to send old links and bookmarks
 * there. Nothing renders here: leaving a second, half-maintained admin
 * surface in place was the problem, not the fix.
 */
export const dynamic = "force-dynamic";

const ADMIN_APP = "/admin-app/";

export default async function ConsolePlatformPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // A non-admin never had anything here beyond their own profile, which lives
  // in settings.
  if (user.role !== "admin") redirect("/chat");
  redirect(ADMIN_APP);
}
