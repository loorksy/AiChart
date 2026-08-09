import { getSettings, getPublicUser } from "./store";
import { allowedAssetsLabel } from "./allowedAssets";

/** Traceable profile facts that still exist in the simplified product model. */
export async function buildUserProfileSummary(userId: number): Promise<string> {
  const [settings, user] = await Promise.all([
    getSettings(userId),
    getPublicUser(userId),
  ]);

  if (!settings || !user) {
    return "No saved user profile is available.";
  }

  return [
    "# User profile facts",
    `- Account: ${user.email}; status: ${user.status} (source: users)`,
    `- Market: Forex / MetaTrader (source: product model)`,
    `- Analysis style: scalping only; higher timeframes are contextual evidence (source: product model)`,
    `- Watchlist: ${allowedAssetsLabel(settings.allowed_assets, "forex")} (source: trading_settings)`,
    `- Risk per Trade: ${settings.per_trade_pct}% of verified broker equity; sizing only after the AI decision (source: trading_settings)`,
  ].join("\n");
}
