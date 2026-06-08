import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listIntents, listTrades } from "@/lib/store";
import AppShell from "@/components/AppShell";
import TradesClient from "@/components/TradesClient";

export default async function TradesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell email={user.email} role={user.role}>
      <TradesClient
        initialIntents={await listIntents(user.id, undefined, 40)}
        initialTrades={await listTrades(user.id, 50)}
      />
    </AppShell>
  );
}
