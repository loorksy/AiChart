import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isOpenAssetsPolicy, parseAllowedAssets } from "@/lib/allowedAssets";
import { getSettings, listRecommendations } from "@/lib/store";
import { getEaConnectionMeta } from "@/lib/eaStore";
import type { MarketType } from "@/lib/markets/types";
import AppShell from "@/components/AppShell";
import MarketClient from "@/components/MarketClient";

export default async function MarketPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const settings = await getSettings(user.id);
  const raw = settings.allowed_assets;

  const cryptoOpen = isOpenAssetsPolicy(raw, "crypto");
  const forexOpen = isOpenAssetsPolicy(raw, "forex");
  const eaMeta = await getEaConnectionMeta(user.id);

  return (
    <AppShell email={user.email} role={user.role} chatLayout>
      <MarketClient
        initialMarket={(settings.active_market as MarketType) ?? "crypto"}
        cryptoOpen={cryptoOpen}
        cryptoAllowed={cryptoOpen ? [] : parseAllowedAssets(raw, "crypto")}
        forexOpen={forexOpen}
        forexAllowed={forexOpen ? [] : parseAllowedAssets(raw, "forex")}
        eaOnline={Boolean(eaMeta?.online)}
        eaConnected={Boolean(eaMeta && eaMeta.status !== "revoked")}
        recommendations={await listRecommendations(user.id, 50)}
      />
    </AppShell>
  );
}
