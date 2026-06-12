import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import CommandCenterClient from "@/components/command/CommandCenterClient";

export default async function CommandPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell email={user.email} role={user.role}>
      <CommandCenterClient />
    </AppShell>
  );
}
