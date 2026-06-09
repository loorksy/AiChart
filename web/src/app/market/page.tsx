import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isOpenAssetsPolicy, parseAllowedAssets } from "@/lib/allowedAssets";
import { getSettings, listRecommendations } from "@/lib/store";
import AppShell from "@/components/AppShell";
import MarketClient from "@/components/MarketClient";

export default async function MarketPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const settings = await getSettings(user.id);
  const openAssets = isOpenAssetsPolicy(settings.allowed_assets);
  const allowed = openAssets
    ? []
    : parseAllowedAssets(settings.allowed_assets);

  return (
    <AppShell email={user.email} role={user.role}>
      <MarketClient
        openAssets={openAssets}
        allowedAssets={allowed}
        recommendations={await listRecommendations(user.id, 50)}
      />
    </AppShell>
  );
}
