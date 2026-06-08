import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listIntents, listTrades } from "@/lib/store";
import Nav from "@/components/Nav";
import TradesClient from "@/components/TradesClient";

export default async function TradesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <TradesClient
        initialIntents={listIntents(user.id, undefined, 40)}
        initialTrades={listTrades(user.id, 50)}
      />
    </>
  );
}
