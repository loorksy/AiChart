import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listIntents, listTrades } from "@/lib/store";
import TradesClient from "@/components/TradesClient";

export default async function ConsoleTradesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <TradesClient
      initialIntents={await listIntents(user.id, undefined, 40)}
      initialTrades={await listTrades(user.id, 50)}
    />
  );
}
