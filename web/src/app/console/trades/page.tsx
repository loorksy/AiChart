import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listIntents, listTrades } from "@/lib/store";
import TradesClient from "@/components/TradesClient";
import { requirePaidPage } from "@/lib/subscription/guards";

export default async function ConsoleTradesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    await requirePaidPage(user, "/console/trades");
  }

  return (
    <TradesClient
      initialIntents={await listIntents(user.id, undefined, 40)}
      initialTrades={await listTrades(user.id, 50)}
    />
  );
}
