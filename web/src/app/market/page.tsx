import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSettings, listRecommendations } from "@/lib/store";
import AppShell from "@/components/AppShell";
import MarketClient from "@/components/MarketClient";

export default async function MarketPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const settings = getSettings(user.id);
  let allowed: string[] = [];
  try {
    allowed = JSON.parse(settings.allowed_assets);
  } catch {
    allowed = [];
  }

  return (
    <AppShell email={user.email} role={user.role}>
      <MarketClient
        allowedAssets={allowed}
        recommendations={listRecommendations(user.id, 50)}
      />
    </AppShell>
  );
}
