import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSettings, getLimits, getBinanceAccountMeta } from "@/lib/store";
import Nav from "@/components/Nav";
import DashboardClient from "@/components/DashboardClient";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const settings = getSettings(user.id);
  const limits = getLimits(user.id);
  const binance = getBinanceAccountMeta(user.id);

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <DashboardClient
        user={user}
        settings={settings}
        limits={limits}
        hasBinance={Boolean(binance)}
      />
    </>
  );
}
