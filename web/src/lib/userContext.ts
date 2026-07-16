import {
  getPublicUser,
  getSettings,
  listTrades,
  listIntents,
  listRecommendations,
  countOpenTrades,
} from "./store";
import { getForexConnectionView } from "./forexConnection";
import { allowedAssetsLabel } from "./allowedAssets";
import { displayNameFromEmail } from "./displayName";

export { displayNameFromEmail };

/** Current, factual context only; no legacy policy or execution-mode memory. */
export async function buildUserContext(userId: number): Promise<string> {
  const user = await getPublicUser(userId);
  if (!user) return "";

  const settings = await getSettings(userId);
  const forex = await getForexConnectionView(userId);
  const trades = await listTrades(userId, 5);
  const intents = await listIntents(userId, "pending", 5);
  const recommendations = await listRecommendations(userId, 3);
  const openTrades = await countOpenTrades(userId);
  const totalTrades = (await listTrades(userId, 200)).length;
  const name = displayNameFromEmail(user.email);

  const connection = forex.online
    ? `connected (${forex.backend === "metaapi" ? "MetaApi" : "EA"})`
    : forex.ea || forex.mt
      ? "linked, offline"
      : "not linked";

  const lines = [
    "# Current user context (factual platform data)",
    `- User: ${name} (${user.email}); account status: ${user.status}`,
    `- Forex connection: ${connection}`,
    `- Analysis style: scalping only; higher timeframes are evidence`,
    `- Risk per Trade: ${settings.per_trade_pct}% of verified broker equity for sizing only`,
    `- Watchlist: ${allowedAssetsLabel(settings.allowed_assets, "forex")}`,
    `- Completed trades: ${totalTrades}; open trades: ${openTrades}; pending approvals: ${intents.length}`,
    `- Telegram: ${settings.telegram_chat_id ? "linked" : "not linked"}`,
  ];

  if (recommendations.length) {
    lines.push(`- Recent recommendations: ${recommendations.map((r) => `${r.symbol} ${r.action}`).join(" · ")}`);
  }
  if (trades.length) {
    lines.push(`- Latest trade: ${trades[0].symbol} ${trades[0].side} (${trades[0].status})`);
  }

  return lines.join("\n");
}
